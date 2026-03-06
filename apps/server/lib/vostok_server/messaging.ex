defmodule VostokServer.Messaging do
  @moduledoc """
  Stage 3 messaging context for direct chats and opaque message envelopes.
  """

  import Ecto.Query

  alias Ecto.Multi
  alias VostokServer.Federation
  alias VostokServer.Identity.{Device, OneTimePrekey, User}

  alias VostokServer.Messaging.{
    Chat,
    ChatReadState,
    ChatDeviceSession,
    ChatSafetyVerification,
    GroupSenderKey,
    ChatMember,
    Message,
    MessageReaction,
    MessageRecipient
  }

  alias VostokServer.Repo
  alias VostokServerWeb.Endpoint

  def list_chats_for_user(user_id) when is_binary(user_id) do
    from(chat in Chat,
      join: membership in ChatMember,
      on: membership.chat_id == chat.id,
      where: membership.user_id == ^user_id,
      order_by: [desc: chat.updated_at, desc: chat.inserted_at],
      preload: [members: ^member_query()]
    )
    |> Repo.all()
    |> Enum.map(&hydrate_chat_summary(&1, user_id))
  end

  def ensure_direct_chat(current_user_id, target_username)
      when is_binary(current_user_id) and is_binary(target_username) do
    with %User{} = current_user <- Repo.get(User, current_user_id),
         %User{} = target_user <-
           Repo.get_by(User, username: String.trim(target_username)),
         {:ok, chat} <- upsert_direct_chat(current_user, target_user) do
      {:ok, present_chat_with_preloaded_members(chat, current_user_id)}
    else
      nil ->
        {:error, {:not_found, "Target user not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def create_group_chat(current_user_id, attrs)
      when is_binary(current_user_id) and is_map(attrs) do
    with %User{} = current_user <- Repo.get(User, current_user_id),
         {:ok, title} <- fetch_string(attrs, "title", "group title"),
         {:ok, member_usernames} <- fetch_username_list(attrs, "members"),
         {:ok, members} <- resolve_group_members(current_user, member_usernames) do
      now = DateTime.utc_now()

      Multi.new()
      |> Multi.insert(
        :chat,
        Chat.changeset(%Chat{}, %{
          type: "group",
          metadata_encrypted: title
        })
      )
      |> Multi.run(:memberships, fn repo, %{chat: chat} ->
        Enum.reduce_while(members, {:ok, []}, fn {user, role}, {:ok, inserted} ->
          case insert_chat_member(repo, chat, user, now, role) do
            {:ok, membership} -> {:cont, {:ok, [membership | inserted]}}
            {:error, reason} -> {:halt, {:error, reason}}
          end
        end)
      end)
      |> Repo.transaction()
      |> case do
        {:ok, %{chat: chat}} ->
          {:ok, present_chat_with_preloaded_members(chat, current_user_id)}

        {:error, _step, reason, _changes} ->
          {:error, reason}
      end
    else
      nil ->
        {:error, {:not_found, "Current user not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def rename_group_chat(chat_id, user_id, attrs)
      when is_binary(chat_id) and is_binary(user_id) and is_map(attrs) do
    with {:ok, membership} <- ensure_membership(chat_id, user_id),
         :ok <- ensure_group_admin(membership),
         %Chat{} = chat <- Repo.get(Chat, chat_id),
         :ok <- ensure_group_chat(chat),
         {:ok, title} <- fetch_string(attrs, "title", "group title"),
         {:ok, updated_chat} <-
           chat
           |> Chat.changeset(%{metadata_encrypted: title})
           |> Repo.update() do
      {:ok, present_chat_with_preloaded_members(updated_chat, user_id)}
    else
      nil ->
        {:error, {:not_found, "Chat not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def list_group_members(chat_id, user_id) when is_binary(chat_id) and is_binary(user_id) do
    with {:ok, _membership} <- ensure_membership(chat_id, user_id),
         %Chat{} = chat <- Repo.get(Chat, chat_id),
         :ok <- ensure_group_chat(chat) do
      members =
        from(chat_member in ChatMember,
          where: chat_member.chat_id == ^chat_id,
          order_by: [asc: chat_member.inserted_at],
          preload: [:user]
        )
        |> Repo.all()
        |> Enum.map(&present_group_member/1)

      {:ok, members}
    else
      nil ->
        {:error, {:not_found, "Chat not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def update_group_member_role(chat_id, current_user_id, target_user_id, attrs)
      when is_binary(chat_id) and is_binary(current_user_id) and is_binary(target_user_id) and
             is_map(attrs) do
    with {:ok, membership} <- ensure_membership(chat_id, current_user_id),
         :ok <- ensure_group_admin(membership),
         %Chat{} = chat <- Repo.get(Chat, chat_id),
         :ok <- ensure_group_chat(chat),
         %ChatMember{} = target_member <-
           Repo.get_by(ChatMember, chat_id: chat_id, user_id: target_user_id),
         {:ok, role} <- fetch_group_role(attrs),
         :ok <- ensure_admin_continuity(chat_id, target_member, role),
         {:ok, updated_member} <-
           target_member |> ChatMember.changeset(%{role: role}) |> Repo.update() do
      {:ok, present_group_member(Repo.preload(updated_member, :user))}
    else
      nil ->
        {:error, {:not_found, "Group member not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def remove_group_member(chat_id, current_user_id, target_user_id)
      when is_binary(chat_id) and is_binary(current_user_id) and is_binary(target_user_id) do
    with {:ok, membership} <- ensure_membership(chat_id, current_user_id),
         :ok <- ensure_group_admin(membership),
         %Chat{} = chat <- Repo.get(Chat, chat_id),
         :ok <- ensure_group_chat(chat),
         %ChatMember{} = target_member <-
           Repo.get_by(ChatMember, chat_id: chat_id, user_id: target_user_id),
         :ok <- ensure_admin_continuity(chat_id, target_member, nil),
         {:ok, deleted_member} <- Repo.delete(target_member) do
      {:ok, present_group_member(Repo.preload(deleted_member, :user))}
    else
      nil ->
        {:error, {:not_found, "Group member not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def distribute_group_sender_keys(chat_id, current_user_id, owner_device_id, attrs)
      when is_binary(chat_id) and is_binary(current_user_id) and is_binary(owner_device_id) and
             is_map(attrs) do
    with {:ok, _membership} <- ensure_membership(chat_id, current_user_id),
         %Chat{} = chat <- Repo.get(Chat, chat_id),
         :ok <- ensure_group_chat(chat),
         {:ok, normalized} <- normalize_sender_key_distribution(attrs),
         {:ok, _recipient_devices} <-
           resolve_group_sender_key_recipients(chat_id, normalized.recipient_device_ids) do
      Repo.transaction(fn ->
        normalized.recipient_wrapped_keys
        |> Enum.reduce([], fn {recipient_device_id, wrapped_sender_key}, inserted ->
          from(group_sender_key in GroupSenderKey,
            where:
              group_sender_key.chat_id == ^chat_id and
                group_sender_key.owner_device_id == ^owner_device_id and
                group_sender_key.recipient_device_id == ^recipient_device_id and
                group_sender_key.status == "active" and
                group_sender_key.key_id != ^normalized.key_id
          )
          |> Repo.update_all(set: [status: "superseded", updated_at: DateTime.utc_now()])

          record =
            case Repo.get_by(GroupSenderKey,
                   chat_id: chat_id,
                   owner_device_id: owner_device_id,
                   recipient_device_id: recipient_device_id,
                   key_id: normalized.key_id
                 ) do
              %GroupSenderKey{} = existing ->
                existing
                |> GroupSenderKey.changeset(%{
                  wrapped_sender_key: wrapped_sender_key,
                  sender_key_epoch: normalized.sender_key_epoch,
                  algorithm: normalized.algorithm,
                  status: "active"
                })
                |> Repo.update()

              nil ->
                %GroupSenderKey{}
                |> GroupSenderKey.changeset(%{
                  chat_id: chat_id,
                  owner_device_id: owner_device_id,
                  recipient_device_id: recipient_device_id,
                  key_id: normalized.key_id,
                  sender_key_epoch: normalized.sender_key_epoch,
                  wrapped_sender_key: wrapped_sender_key,
                  algorithm: normalized.algorithm,
                  status: "active"
                })
                |> Repo.insert()
            end

          case record do
            {:ok, group_sender_key} ->
              [present_group_sender_key(group_sender_key) | inserted]

            {:error, changeset} ->
              Repo.rollback({:validation, format_changeset_error(changeset)})
          end
        end)
        |> Enum.reverse()
      end)
      |> case do
        {:ok, sender_keys} -> {:ok, sender_keys}
        {:error, reason} -> {:error, reason}
      end
    else
      nil ->
        {:error, {:not_found, "Chat not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def list_group_sender_keys(chat_id, current_user_id, recipient_device_id)
      when is_binary(chat_id) and is_binary(current_user_id) and is_binary(recipient_device_id) do
    with {:ok, _membership} <- ensure_membership(chat_id, current_user_id),
         %Chat{} = chat <- Repo.get(Chat, chat_id),
         :ok <- ensure_group_chat(chat) do
      sender_keys =
        from(group_sender_key in GroupSenderKey,
          where:
            group_sender_key.chat_id == ^chat_id and
              group_sender_key.recipient_device_id == ^recipient_device_id and
              group_sender_key.status == "active",
          order_by: [desc: group_sender_key.inserted_at]
        )
        |> Repo.all()
        |> Enum.map(&present_group_sender_key/1)

      {:ok, sender_keys}
    else
      nil ->
        {:error, {:not_found, "Chat not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def list_safety_numbers(chat_id, current_user_id, verifier_device_id)
      when is_binary(chat_id) and is_binary(current_user_id) and is_binary(verifier_device_id) do
    with {:ok, _membership} <- ensure_membership(chat_id, current_user_id),
         %Device{} = verifier_device <- Repo.get(Device, verifier_device_id),
         :ok <- ensure_device_belongs_to_user(verifier_device, current_user_id) do
      peer_devices =
        from(chat_member in ChatMember,
          join: user in User,
          on: user.id == chat_member.user_id,
          join: device in Device,
          on:
            device.user_id == chat_member.user_id and is_nil(device.revoked_at) and
              not is_nil(device.identity_public_key),
          where: chat_member.chat_id == ^chat_id and device.id != ^verifier_device_id,
          order_by: [asc: user.username, asc: device.device_name, asc: device.inserted_at],
          select: %{
            user_id: user.id,
            username: user.username,
            device_id: device.id,
            device_name: device.device_name,
            identity_public_key: device.identity_public_key
          }
        )
        |> Repo.all()

      verification_map =
        from(verification in ChatSafetyVerification,
          where:
            verification.chat_id == ^chat_id and
              verification.verifier_device_id == ^verifier_device_id,
          select: {verification.peer_device_id, verification}
        )
        |> Repo.all()
        |> Map.new()

      safety_numbers =
        peer_devices
        |> Enum.map(fn peer ->
          fingerprint =
            safety_number_fingerprint(
              verifier_device.identity_public_key,
              peer.identity_public_key
            )

          verification = Map.get(verification_map, peer.device_id)
          verified_at = verification && verification.verified_at
          verified = !is_nil(verified_at) and verification.fingerprint == fingerprint

          %{
            chat_id: chat_id,
            peer_device_id: peer.device_id,
            peer_user_id: peer.user_id,
            peer_username: peer.username,
            peer_device_name: peer.device_name,
            fingerprint: fingerprint,
            verified: verified,
            verified_at: iso_or_nil(verified_at)
          }
        end)

      {:ok, safety_numbers}
    else
      nil ->
        {:error, {:not_found, "Verifier device not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def verify_safety_number(chat_id, current_user_id, verifier_device_id, peer_device_id)
      when is_binary(chat_id) and is_binary(current_user_id) and is_binary(verifier_device_id) and
             is_binary(peer_device_id) do
    with {:ok, _membership} <- ensure_membership(chat_id, current_user_id),
         %Device{} = verifier_device <- Repo.get(Device, verifier_device_id),
         :ok <- ensure_device_belongs_to_user(verifier_device, current_user_id),
         {:ok, peer} <- resolve_safety_peer_device(chat_id, peer_device_id),
         :ok <- ensure_not_self_safety_device(verifier_device_id, peer.device_id) do
      fingerprint =
        safety_number_fingerprint(verifier_device.identity_public_key, peer.identity_public_key)

      now = DateTime.utc_now()

      upserted =
        case Repo.get_by(ChatSafetyVerification,
               chat_id: chat_id,
               verifier_device_id: verifier_device_id,
               peer_device_id: peer.device_id
             ) do
          %ChatSafetyVerification{} = existing ->
            existing
            |> ChatSafetyVerification.changeset(%{
              fingerprint: fingerprint,
              verified_at: now
            })
            |> Repo.update()

          nil ->
            %ChatSafetyVerification{}
            |> ChatSafetyVerification.changeset(%{
              chat_id: chat_id,
              verifier_device_id: verifier_device_id,
              peer_device_id: peer.device_id,
              fingerprint: fingerprint,
              verified_at: now
            })
            |> Repo.insert()
        end

      case upserted do
        {:ok, verification} ->
          {:ok,
           %{
             chat_id: chat_id,
             peer_device_id: peer.device_id,
             peer_user_id: peer.user_id,
             peer_username: peer.username,
             peer_device_name: peer.device_name,
             fingerprint: fingerprint,
             verified: true,
             verified_at: iso_or_nil(verification.verified_at)
           }}

        {:error, changeset} ->
          {:error, {:validation, format_changeset_error(changeset)}}
      end
    else
      nil ->
        {:error, {:not_found, "Verifier device not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def list_recipient_devices(chat_id, user_id) when is_binary(chat_id) and is_binary(user_id) do
    with {:ok, _membership} <- ensure_membership(chat_id, user_id) do
      devices =
        from(chat_member in ChatMember,
          join: device in Device,
          on: device.user_id == chat_member.user_id and is_nil(device.revoked_at),
          where: chat_member.chat_id == ^chat_id and not is_nil(device.encryption_public_key),
          select: %{
            device_id: device.id,
            encryption_public_key: device.encryption_public_key,
            user_id: device.user_id
          }
        )
        |> Repo.all()
        |> Enum.map(fn device ->
          %{
            device_id: device.device_id,
            user_id: device.user_id,
            encryption_public_key: Base.encode64(device.encryption_public_key)
          }
        end)

      {:ok, devices}
    end
  end

  def list_messages_for_chat(chat_id, user_id, current_device_id)
      when is_binary(chat_id) and is_binary(user_id) and is_binary(current_device_id) do
    with {:ok, _membership} <- ensure_membership(chat_id, user_id) do
      from(message in Message,
        where: message.chat_id == ^chat_id,
        order_by: [asc: message.inserted_at],
        preload: [recipient_envelopes: ^recipient_query(), reactions: ^reaction_query()]
      )
      |> Repo.all()
      |> Enum.map(&present_message(&1, current_device_id, user_id))
      |> then(&{:ok, &1})
    end
  end

  def mark_chat_read(chat_id, user_id, current_device_id, attrs \\ %{})

  def mark_chat_read(chat_id, user_id, current_device_id, attrs)
      when is_binary(chat_id) and is_binary(user_id) and is_binary(current_device_id) and
             is_map(attrs) do
    with {:ok, _membership} <- ensure_membership(chat_id, user_id),
         {:ok, last_read_message_id} <- normalize_last_read_message_id(attrs),
         :ok <- ensure_read_message_belongs_to_chat(chat_id, last_read_message_id) do
      now = DateTime.utc_now()

      upserted =
        case Repo.get_by(ChatReadState, chat_id: chat_id, device_id: current_device_id) do
          %ChatReadState{} = existing ->
            next_last_read_message_id =
              if is_nil(last_read_message_id) do
                existing.last_read_message_id
              else
                last_read_message_id
              end

            existing
            |> ChatReadState.changeset(%{
              last_read_message_id: next_last_read_message_id,
              read_at: now
            })
            |> Repo.update()

          nil ->
            %ChatReadState{}
            |> ChatReadState.changeset(%{
              chat_id: chat_id,
              device_id: current_device_id,
              last_read_message_id: last_read_message_id,
              read_at: now
            })
            |> Repo.insert()
        end

      case upserted do
        {:ok, read_state} ->
          {:ok,
           %{
             chat_id: read_state.chat_id,
             device_id: read_state.device_id,
             last_read_message_id: read_state.last_read_message_id,
             read_at: iso_or_nil(read_state.read_at)
           }}

        {:error, changeset} ->
          {:error, {:validation, format_changeset_error(changeset)}}
      end
    end
  end

  defp normalize_last_read_message_id(attrs) when is_map(attrs) do
    value =
      Map.get(attrs, "last_read_message_id")
      |> case do
        nil -> Map.get(attrs, "message_id")
        present -> present
      end
      |> normalize_string()

    {:ok, value}
  end

  defp ensure_read_message_belongs_to_chat(_chat_id, nil), do: :ok

  defp ensure_read_message_belongs_to_chat(chat_id, last_read_message_id)
       when is_binary(chat_id) and is_binary(last_read_message_id) do
    case Repo.get(Message, last_read_message_id) do
      %Message{chat_id: ^chat_id} ->
        :ok

      %Message{} ->
        {:error, {:validation, "last_read_message_id must reference a message in this chat."}}

      nil ->
        {:error, {:not_found, "last_read_message_id not found."}}
    end
  end

  def bootstrap_chat_sessions(chat_id, user_id, current_device_id, attrs \\ %{})

  def bootstrap_chat_sessions(chat_id, user_id, current_device_id, attrs)
      when is_binary(chat_id) and is_binary(user_id) and is_binary(current_device_id) and
             is_map(attrs) do
    with {:ok, _membership} <- ensure_membership(chat_id, user_id),
         %Device{} = current_device <- Repo.get(Device, current_device_id),
         {:ok, current_device} <- validate_bootstrap_device(current_device),
         {:ok, normalized} <- normalize_bootstrap_attrs(attrs) do
      Repo.transaction(fn ->
        self_session =
          case ensure_chat_device_session(
                 chat_id,
                 current_device,
                 current_device,
                 true,
                 normalized.initiator_ephemeral_keys
               ) do
            {:ok, session} -> session
            {:error, reason} -> Repo.rollback(reason)
          end

        outbound_sessions =
          other_bootstrap_target_devices(chat_id, current_device.id)
          |> Enum.reduce([], fn target_device, sessions ->
            case ensure_chat_device_session(
                   chat_id,
                   current_device,
                   target_device,
                   false,
                   normalized.initiator_ephemeral_keys
                 ) do
              {:ok, session} -> [session | sessions]
              {:error, reason} -> Repo.rollback(reason)
            end
          end)
          |> Enum.reverse()

        inbound_sessions = list_inbound_chat_sessions(chat_id, current_device.id)

        ([self_session | outbound_sessions] ++ inbound_sessions)
        |> Enum.uniq_by(& &1.id)
        |> Enum.map(&present_chat_device_session/1)
      end)
    else
      nil ->
        {:error, {:not_found, "Device not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def rekey_chat_sessions(chat_id, user_id, current_device_id, attrs \\ %{})

  def rekey_chat_sessions(chat_id, user_id, current_device_id, attrs)
      when is_binary(chat_id) and is_binary(user_id) and is_binary(current_device_id) and
             is_map(attrs) do
    with {:ok, _membership} <- ensure_membership(chat_id, user_id),
         %Device{} = current_device <- Repo.get(Device, current_device_id),
         {:ok, current_device} <- validate_bootstrap_device(current_device),
         {:ok, normalized} <- normalize_bootstrap_attrs(attrs),
         {:ok, target_devices} <-
           resolve_explicit_rekey_targets(
             chat_id,
             current_device,
             normalized.initiator_ephemeral_keys
           ) do
      Repo.transaction(fn ->
        outbound_sessions =
          target_devices
          |> Enum.reduce([], fn target_device, sessions ->
            case rekey_chat_device_session(
                   chat_id,
                   current_device,
                   target_device,
                   current_device.id == target_device.id,
                   normalized.initiator_ephemeral_keys
                 ) do
              {:ok, session} -> [session | sessions]
              {:error, reason} -> Repo.rollback(reason)
            end
          end)
          |> Enum.reverse()

        inbound_sessions = list_inbound_chat_sessions(chat_id, current_device.id)

        (outbound_sessions ++ inbound_sessions)
        |> Enum.uniq_by(& &1.id)
        |> Enum.map(&present_chat_device_session/1)
      end)
    else
      nil ->
        {:error, {:not_found, "Device not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def create_message(chat_id, sender_device_id, user_id, attrs, current_device_id)
      when is_binary(chat_id) and is_binary(sender_device_id) and is_binary(user_id) and
             is_binary(current_device_id) and is_map(attrs) do
    with {:ok, _membership} <- ensure_membership(chat_id, user_id),
         %Chat{} = chat <- Repo.get(Chat, chat_id),
         {:ok, normalized} <- normalize_message_attrs(attrs),
         {:ok, _reply_target} <- validate_reply_target(chat_id, normalized.reply_to_message_id),
         {:ok, recipient_device_ids} <- recipient_device_ids(chat_id),
         :ok <-
           ensure_group_message_transport(
             chat,
             sender_device_id,
             normalized,
             recipient_device_ids
           ) do
      Multi.new()
      |> Multi.insert(:message, build_message_changeset(chat_id, sender_device_id, normalized))
      |> Multi.run(:recipient_envelopes, fn repo, %{message: message} ->
        insert_recipient_envelopes(
          repo,
          message,
          recipient_device_ids,
          normalized.ciphertext,
          normalized.recipient_envelopes
        )
      end)
      |> Multi.run(:established_sessions, fn repo, _changes ->
        mark_established_sessions(
          repo,
          chat_id,
          sender_device_id,
          normalized.established_session_ids
        )
      end)
      |> Multi.update_all(
        :touch_chat,
        from(chat in Chat, where: chat.id == ^chat_id),
        set: [updated_at: DateTime.utc_now()]
      )
      |> Repo.transaction()
      |> case do
        {:ok, %{message: message}} ->
          message =
            message
            |> Repo.preload(recipient_envelopes: recipient_query(), reactions: reaction_query())
            |> Map.from_struct()
            |> Map.take([
              :id,
              :chat_id,
              :client_id,
              :message_kind,
              :crypto_scheme,
              :sender_key_id,
              :sender_key_epoch,
              :sender_device_id,
              :inserted_at,
              :pinned_at,
              :edited_at,
              :deleted_at,
              :header,
              :ciphertext,
              :reply_to_message_id,
              :recipient_envelopes,
              :reactions
            ])

          presented_message = present_message(message, current_device_id, user_id)
          broadcast_message(chat_id, message.id)
          maybe_queue_federation_message(chat_id, message)

          {:ok, presented_message}

        {:error, _step, reason, _changes} ->
          {:error, reason}
      end
    else
      nil ->
        {:error, {:not_found, "Chat not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def create_system_message(chat_id, sender_device_id, text)
      when is_binary(chat_id) and is_binary(sender_device_id) and is_binary(text) do
    Multi.new()
    |> Multi.insert(
      :message,
      %Message{chat_id: chat_id, sender_device_id: sender_device_id}
      |> Message.changeset(%{
        client_id: "system-#{Ecto.UUID.generate()}",
        ciphertext: text,
        message_kind: "system"
      })
    )
    |> Multi.update_all(
      :touch_chat,
      from(chat in Chat, where: chat.id == ^chat_id),
      set: [updated_at: DateTime.utc_now()]
    )
    |> Repo.transaction()
    |> case do
      {:ok, %{message: message}} ->
        broadcast_message(chat_id, message.id)
        {:ok, %{id: message.id}}

      {:error, _step, reason, _changes} ->
        {:error, reason}
    end
  end

  def ingest_federated_message(chat_id, sender_device_id, attrs)
      when is_binary(chat_id) and is_binary(sender_device_id) and is_map(attrs) do
    with %Chat{} = chat <- Repo.get(Chat, chat_id),
         %Device{} <- Repo.get(Device, sender_device_id),
         {:ok, normalized} <- normalize_message_attrs(attrs),
         {:ok, _reply_target} <- validate_reply_target(chat_id, normalized.reply_to_message_id),
         {:ok, recipient_device_ids} <- recipient_device_ids(chat_id),
         :ok <-
           ensure_group_message_transport(
             chat,
             sender_device_id,
             normalized,
             recipient_device_ids
           ) do
      case Repo.get_by(Message, client_id: normalized.client_id) do
        %Message{chat_id: ^chat_id} = existing ->
          {:ok, %{id: existing.id, duplicate: true}}

        %Message{} ->
          {:error, {:validation, "client_id already exists for a different chat."}}

        nil ->
          Multi.new()
          |> Multi.insert(
            :message,
            build_message_changeset(chat_id, sender_device_id, normalized)
          )
          |> Multi.run(:recipient_envelopes, fn repo, %{message: message} ->
            insert_recipient_envelopes(
              repo,
              message,
              recipient_device_ids,
              normalized.ciphertext,
              normalized.recipient_envelopes
            )
          end)
          |> Multi.update_all(
            :touch_chat,
            from(chat in Chat, where: chat.id == ^chat_id),
            set: [updated_at: DateTime.utc_now()]
          )
          |> Repo.transaction()
          |> case do
            {:ok, %{message: message}} ->
              broadcast_message(chat_id, message.id)
              {:ok, %{id: message.id, duplicate: false}}

            {:error, _step, reason, _changes} ->
              {:error, reason}
          end
      end
    else
      nil ->
        {:error, {:not_found, "Chat or sender device not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def edit_message(chat_id, message_id, sender_device_id, user_id, attrs, current_device_id)
      when is_binary(chat_id) and is_binary(message_id) and is_binary(sender_device_id) and
             is_binary(user_id) and is_binary(current_device_id) and is_map(attrs) do
    with {:ok, membership} <- ensure_membership(chat_id, user_id),
         %Chat{} = chat <- Repo.get(Chat, chat_id),
         {:ok, normalized} <- normalize_message_attrs(attrs),
         %Message{} = message <- Repo.get(Message, message_id),
         :ok <- ensure_message_chat(message, chat_id),
         :ok <- ensure_message_edit_permission(chat, membership, message, sender_device_id),
         :ok <- ensure_not_deleted(message),
         {:ok, _reply_target} <- validate_reply_target(chat_id, normalized.reply_to_message_id),
         {:ok, recipient_device_ids} <- recipient_device_ids(chat_id),
         :ok <-
           ensure_group_message_transport(
             chat,
             sender_device_id,
             normalized,
             recipient_device_ids
           ) do
      Multi.new()
      |> Multi.update(
        :message,
        message
        |> Message.changeset(%{
          header: normalized.header,
          ciphertext: normalized.ciphertext,
          message_kind: normalized.message_kind,
          crypto_scheme: normalized.crypto_scheme,
          sender_key_id: normalized.sender_key_id,
          sender_key_epoch: normalized.sender_key_epoch,
          reply_to_message_id: normalized.reply_to_message_id,
          edited_at: DateTime.utc_now()
        })
      )
      |> Multi.delete_all(
        :clear_recipient_envelopes,
        from(message_recipient in MessageRecipient,
          where: message_recipient.message_id == ^message.id
        )
      )
      |> Multi.run(:recipient_envelopes, fn repo, %{message: updated_message} ->
        insert_recipient_envelopes(
          repo,
          updated_message,
          recipient_device_ids,
          normalized.ciphertext,
          normalized.recipient_envelopes
        )
      end)
      |> Multi.run(:established_sessions, fn repo, _changes ->
        mark_established_sessions(
          repo,
          chat_id,
          sender_device_id,
          normalized.established_session_ids
        )
      end)
      |> Multi.update_all(
        :touch_chat,
        from(chat in Chat, where: chat.id == ^chat_id),
        set: [updated_at: DateTime.utc_now()]
      )
      |> Repo.transaction()
      |> case do
        {:ok, %{message: updated_message}} ->
          updated_message =
            updated_message
            |> Repo.preload(recipient_envelopes: recipient_query(), reactions: reaction_query())
            |> present_message(current_device_id, user_id)

          broadcast_message(chat_id, updated_message.id)
          {:ok, updated_message}

        {:error, _step, reason, _changes} ->
          {:error, reason}
      end
    else
      nil ->
        {:error, {:not_found, "Chat or message not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def delete_message(chat_id, message_id, sender_device_id, user_id, current_device_id)
      when is_binary(chat_id) and is_binary(message_id) and is_binary(sender_device_id) and
             is_binary(user_id) and is_binary(current_device_id) do
    with {:ok, membership} <- ensure_membership(chat_id, user_id),
         %Chat{} = chat <- Repo.get(Chat, chat_id),
         %Message{} = message <- Repo.get(Message, message_id),
         :ok <- ensure_message_chat(message, chat_id),
         :ok <- ensure_message_delete_permission(chat, membership, message, sender_device_id),
         :ok <- ensure_not_deleted(message) do
      Multi.new()
      |> Multi.update(
        :message,
        message
        |> Message.changeset(%{
          header: nil,
          ciphertext: <<0>>,
          pinned_at: nil,
          deleted_at: DateTime.utc_now()
        })
      )
      |> Multi.delete_all(
        :clear_recipient_envelopes,
        from(message_recipient in MessageRecipient,
          where: message_recipient.message_id == ^message.id
        )
      )
      |> Multi.update_all(
        :touch_chat,
        from(chat in Chat, where: chat.id == ^chat_id),
        set: [updated_at: DateTime.utc_now()]
      )
      |> Repo.transaction()
      |> case do
        {:ok, %{message: deleted_message}} ->
          deleted_message =
            deleted_message
            |> Repo.preload(recipient_envelopes: recipient_query(), reactions: reaction_query())
            |> present_message(current_device_id, user_id)

          broadcast_message(chat_id, deleted_message.id)
          {:ok, deleted_message}

        {:error, _step, reason, _changes} ->
          {:error, reason}
      end
    else
      nil ->
        {:error, {:not_found, "Message not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def toggle_message_pin(chat_id, message_id, user_id, current_device_id)
      when is_binary(chat_id) and is_binary(message_id) and is_binary(user_id) and
             is_binary(current_device_id) do
    with {:ok, membership} <- ensure_membership(chat_id, user_id),
         %Chat{} = chat <- Repo.get(Chat, chat_id),
         %Message{} = message <- Repo.get(Message, message_id),
         :ok <- ensure_message_chat(message, chat_id),
         :ok <- ensure_message_pin_permission(chat, membership),
         :ok <- ensure_not_deleted(message),
         :ok <- ensure_pinnable(message) do
      Repo.transaction(fn ->
        next_pinned_at =
          if message.pinned_at do
            nil
          else
            DateTime.utc_now()
          end

        if next_pinned_at do
          from(existing in Message,
            where: existing.chat_id == ^chat_id and not is_nil(existing.pinned_at)
          )
          |> Repo.update_all(set: [pinned_at: nil])
        end

        message
        |> Message.changeset(%{pinned_at: next_pinned_at})
        |> Repo.update!()
        |> Repo.preload(recipient_envelopes: recipient_query(), reactions: reaction_query())
        |> present_message(current_device_id, user_id)
      end)
      |> case do
        {:ok, presented_message} ->
          broadcast_message(chat_id, presented_message.id)
          {:ok, presented_message}

        {:error, reason} ->
          {:error, reason}
      end
    else
      nil ->
        {:error, {:not_found, "Message not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def toggle_message_reaction(chat_id, message_id, user_id, current_device_id, attrs)
      when is_binary(chat_id) and is_binary(message_id) and is_binary(user_id) and
             is_binary(current_device_id) and is_map(attrs) do
    with {:ok, _membership} <- ensure_membership(chat_id, user_id),
         {:ok, reaction_key} <- fetch_string(attrs, "reaction_key", "reaction key"),
         %Message{} = message <- Repo.get(Message, message_id),
         :ok <- ensure_not_deleted(message),
         :ok <- ensure_message_chat(message, chat_id) do
      Repo.transaction(fn ->
        reaction =
          Repo.get_by(MessageReaction,
            message_id: message.id,
            user_id: user_id,
            reaction_key: reaction_key
          )

        if reaction do
          Repo.delete!(reaction)
        else
          %MessageReaction{}
          |> MessageReaction.changeset(%{
            message_id: message.id,
            user_id: user_id,
            reaction_key: reaction_key
          })
          |> Repo.insert!()
        end

        message
        |> Repo.preload(recipient_envelopes: recipient_query(), reactions: reaction_query())
        |> present_message(current_device_id, user_id)
      end)
      |> case do
        {:ok, presented_message} -> {:ok, presented_message}
        {:error, reason} -> {:error, reason}
      end
    else
      nil ->
        {:error, {:not_found, "Message not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def ensure_membership(chat_id, user_id) when is_binary(chat_id) and is_binary(user_id) do
    case Repo.get_by(ChatMember, chat_id: chat_id, user_id: user_id) do
      %ChatMember{} = membership -> {:ok, membership}
      nil -> {:error, {:not_found, "Chat not found for this user."}}
    end
  end

  defp upsert_direct_chat(%User{} = current_user, %User{} = target_user) do
    direct_key = direct_key(current_user.id, target_user.id)

    case Repo.get_by(Chat, direct_key: direct_key) do
      %Chat{} = chat ->
        {:ok, chat}

      nil ->
        now = DateTime.utc_now()

        Multi.new()
        |> Multi.insert(
          :chat,
          Chat.changeset(%Chat{}, %{
            type: "direct",
            direct_key: direct_key
          })
        )
        |> Multi.run(:current_member, fn repo, %{chat: chat} ->
          insert_chat_member(repo, chat, current_user, now)
        end)
        |> Multi.run(:target_member, fn repo, %{chat: chat} ->
          if current_user.id == target_user.id do
            {:ok, :self_chat}
          else
            insert_chat_member(repo, chat, target_user, now)
          end
        end)
        |> Repo.transaction()
        |> case do
          {:ok, %{chat: chat}} -> {:ok, chat}
          {:error, _step, reason, _changes} -> {:error, reason}
        end
    end
  end

  defp insert_chat_member(repo, %Chat{} = chat, %User{} = user, joined_at, role \\ "member") do
    chat
    |> Ecto.build_assoc(:members, user_id: user.id)
    |> ChatMember.changeset(%{role: role, joined_at: joined_at})
    |> repo.insert()
  end

  defp validate_bootstrap_device(%Device{revoked_at: revoked_at}) when not is_nil(revoked_at) do
    {:error, {:unauthorized, "This device has been revoked."}}
  end

  defp validate_bootstrap_device(%Device{} = device) do
    cond do
      is_nil(device.identity_public_key) ->
        {:error, {:validation, "The current device is missing an identity public key."}}

      is_nil(device.encryption_public_key) ->
        {:error, {:validation, "The current device is missing an encryption public key."}}

      is_nil(device.signed_prekey) ->
        {:error, {:validation, "The current device is missing a signed prekey."}}

      is_nil(device.signed_prekey_signature) ->
        {:error, {:validation, "The current device is missing a signed prekey signature."}}

      true ->
        {:ok, device}
    end
  end

  defp other_bootstrap_target_devices(chat_id, current_device_id) do
    from(chat_member in ChatMember,
      join: device in Device,
      on: device.user_id == chat_member.user_id and is_nil(device.revoked_at),
      where:
        chat_member.chat_id == ^chat_id and device.id != ^current_device_id and
          not is_nil(device.identity_public_key) and not is_nil(device.encryption_public_key) and
          not is_nil(device.signed_prekey) and not is_nil(device.signed_prekey_signature),
      select: device,
      order_by: [asc: device.inserted_at]
    )
    |> Repo.all()
  end

  defp rekey_target_devices(chat_id, current_device_id, recipient_device_ids) do
    from(chat_member in ChatMember,
      join: device in Device,
      on: device.user_id == chat_member.user_id and is_nil(device.revoked_at),
      where:
        chat_member.chat_id == ^chat_id and device.id != ^current_device_id and
          device.id in ^recipient_device_ids and not is_nil(device.identity_public_key) and
          not is_nil(device.encryption_public_key) and not is_nil(device.signed_prekey) and
          not is_nil(device.signed_prekey_signature),
      select: device,
      order_by: [asc: device.inserted_at]
    )
    |> Repo.all()
  end

  defp ensure_chat_device_session(
         chat_id,
         %Device{} = initiator,
         %Device{} = recipient,
         self_session?,
         initiator_ephemeral_keys
       ) do
    desired_initiator_ephemeral_public_key = Map.get(initiator_ephemeral_keys, recipient.id)

    case current_chat_device_session(chat_id, initiator.id, recipient.id) do
      %ChatDeviceSession{} = session ->
        maybe_refresh_initiator_ephemeral_public_key(
          session,
          desired_initiator_ephemeral_public_key,
          recipient.id
        )

      nil ->
        with {:ok, initiator_ephemeral_public_key} <-
               require_initiator_ephemeral_public_key(
                 desired_initiator_ephemeral_public_key,
                 recipient.id
               ) do
          create_chat_device_session(
            chat_id,
            initiator,
            recipient,
            self_session?,
            initiator_ephemeral_public_key
          )
        end
    end
  end

  defp rekey_chat_device_session(
         chat_id,
         %Device{} = initiator,
         %Device{} = recipient,
         self_session?,
         initiator_ephemeral_keys
       ) do
    desired_initiator_ephemeral_public_key = Map.get(initiator_ephemeral_keys, recipient.id)

    with {:ok, initiator_ephemeral_public_key} <-
           require_initiator_ephemeral_public_key(
             desired_initiator_ephemeral_public_key,
             recipient.id
           ) do
      recipient_one_time_prekey_record =
        if self_session? do
          nil
        else
          claim_one_time_prekey(recipient.id)
        end

      case current_chat_device_session(chat_id, initiator.id, recipient.id) do
        %ChatDeviceSession{} = session ->
          with {:ok, _superseded_session} <- supersede_chat_device_session(session) do
            create_chat_device_session(
              chat_id,
              initiator,
              recipient,
              self_session?,
              initiator_ephemeral_public_key,
              recipient_one_time_prekey_record
            )
          end

        nil ->
          create_chat_device_session(
            chat_id,
            initiator,
            recipient,
            self_session?,
            initiator_ephemeral_public_key,
            recipient_one_time_prekey_record
          )
      end
    end
  end

  defp create_chat_device_session(
         chat_id,
         %Device{} = initiator,
         %Device{} = recipient,
         self_session?,
         initiator_ephemeral_public_key,
         recipient_one_time_prekey_record \\ nil
       ) do
    recipient_one_time_prekey_record =
      cond do
        self_session? ->
          nil

        recipient_one_time_prekey_record ->
          recipient_one_time_prekey_record

        true ->
          claim_one_time_prekey(recipient.id)
      end

    %ChatDeviceSession{}
    |> ChatDeviceSession.changeset(%{
      chat_id: chat_id,
      initiator_device_id: initiator.id,
      recipient_device_id: recipient.id,
      recipient_one_time_prekey_record_id:
        recipient_one_time_prekey_record && recipient_one_time_prekey_record.id,
      status: "active",
      established_at: nil,
      superseded_at: nil,
      initiator_identity_public_key: initiator.identity_public_key,
      initiator_encryption_public_key: initiator.encryption_public_key,
      initiator_ephemeral_public_key: initiator_ephemeral_public_key,
      initiator_signed_prekey: initiator.signed_prekey,
      initiator_signed_prekey_signature: initiator.signed_prekey_signature,
      recipient_identity_public_key: recipient.identity_public_key,
      recipient_encryption_public_key: recipient.encryption_public_key,
      recipient_signed_prekey: recipient.signed_prekey,
      recipient_signed_prekey_signature: recipient.signed_prekey_signature,
      recipient_one_time_prekey:
        recipient_one_time_prekey_record && recipient_one_time_prekey_record.public_key
    })
    |> Repo.insert()
  end

  defp current_chat_device_session(chat_id, initiator_device_id, recipient_device_id) do
    from(session in ChatDeviceSession,
      where:
        session.chat_id == ^chat_id and session.initiator_device_id == ^initiator_device_id and
          session.recipient_device_id == ^recipient_device_id and is_nil(session.superseded_at),
      limit: 1
    )
    |> Repo.one()
  end

  defp supersede_chat_device_session(%ChatDeviceSession{} = session) do
    session
    |> ChatDeviceSession.changeset(%{superseded_at: DateTime.utc_now()})
    |> Repo.update()
  end

  defp resolve_explicit_rekey_targets(
         chat_id,
         %Device{} = current_device,
         initiator_ephemeral_keys
       ) do
    requested_device_ids = Map.keys(initiator_ephemeral_keys)

    cond do
      requested_device_ids == [] ->
        {:error,
         {:validation,
          "initiator_ephemeral_keys must include at least one recipient device for explicit rekey."}}

      Enum.any?(requested_device_ids, &(&1 == current_device.id)) ->
        target_devices =
          [
            current_device
            | rekey_target_devices(chat_id, current_device.id, requested_device_ids)
          ]
          |> Enum.uniq_by(& &1.id)

        if length(target_devices) == length(Enum.uniq(requested_device_ids)) do
          {:ok, target_devices}
        else
          {:error,
           {:validation,
            "initiator_ephemeral_keys contains a device that is not an eligible chat recipient."}}
        end

      true ->
        target_devices = rekey_target_devices(chat_id, current_device.id, requested_device_ids)

        if length(target_devices) == length(Enum.uniq(requested_device_ids)) do
          {:ok, target_devices}
        else
          {:error,
           {:validation,
            "initiator_ephemeral_keys contains a device that is not an eligible chat recipient."}}
        end
    end
  end

  defp claim_one_time_prekey(device_id) do
    now = DateTime.utc_now()

    case Repo.one(
           from(prekey in OneTimePrekey,
             where: prekey.device_id == ^device_id and is_nil(prekey.used_at),
             order_by: [asc: prekey.inserted_at],
             limit: 1
           )
         ) do
      %OneTimePrekey{} = prekey ->
        prekey
        |> OneTimePrekey.changeset(%{used_at: now})
        |> Repo.update!()

      nil ->
        nil
    end
  end

  defp list_inbound_chat_sessions(chat_id, current_device_id) do
    from(session in ChatDeviceSession,
      where: session.chat_id == ^chat_id and session.recipient_device_id == ^current_device_id,
      order_by: [asc: session.inserted_at]
    )
    |> Repo.all()
  end

  defp present_chat_device_session(%ChatDeviceSession{} = session) do
    %{
      id: session.id,
      chat_id: session.chat_id,
      status: session.status,
      established_at: iso_or_nil(session.established_at),
      superseded_at: iso_or_nil(session.superseded_at),
      establishment_state:
        if(is_nil(session.established_at), do: "pending_first_message", else: "established"),
      session_state: if(is_nil(session.superseded_at), do: "active", else: "superseded"),
      handshake_hash: encode_binary(session_handshake_hash(session)),
      initiator_device_id: session.initiator_device_id,
      recipient_device_id: session.recipient_device_id,
      initiator_identity_public_key: Base.encode64(session.initiator_identity_public_key),
      initiator_encryption_public_key: Base.encode64(session.initiator_encryption_public_key),
      initiator_ephemeral_public_key: encode_binary(session.initiator_ephemeral_public_key),
      initiator_signed_prekey: Base.encode64(session.initiator_signed_prekey),
      initiator_signed_prekey_signature: Base.encode64(session.initiator_signed_prekey_signature),
      recipient_identity_public_key: Base.encode64(session.recipient_identity_public_key),
      recipient_encryption_public_key: Base.encode64(session.recipient_encryption_public_key),
      recipient_signed_prekey: Base.encode64(session.recipient_signed_prekey),
      recipient_signed_prekey_signature: Base.encode64(session.recipient_signed_prekey_signature),
      recipient_one_time_prekey: encode_binary(session.recipient_one_time_prekey)
    }
  end

  defp session_handshake_hash(%ChatDeviceSession{} = session) do
    session
    |> session_handshake_transcript()
    |> Jason.encode_to_iodata!()
    |> then(&:crypto.hash(:sha256, &1))
  end

  defp session_handshake_transcript(%ChatDeviceSession{} = session) do
    [
      ["chat_id", session.chat_id],
      ["session_id", session.id],
      ["initiator_device_id", session.initiator_device_id],
      ["recipient_device_id", session.recipient_device_id],
      ["initiator_identity_public_key", encode_binary(session.initiator_identity_public_key)],
      ["initiator_encryption_public_key", encode_binary(session.initiator_encryption_public_key)],
      ["initiator_ephemeral_public_key", encode_binary(session.initiator_ephemeral_public_key)],
      ["initiator_signed_prekey", encode_binary(session.initiator_signed_prekey)],
      [
        "initiator_signed_prekey_signature",
        encode_binary(session.initiator_signed_prekey_signature)
      ],
      ["recipient_identity_public_key", encode_binary(session.recipient_identity_public_key)],
      ["recipient_encryption_public_key", encode_binary(session.recipient_encryption_public_key)],
      ["recipient_signed_prekey", encode_binary(session.recipient_signed_prekey)],
      [
        "recipient_signed_prekey_signature",
        encode_binary(session.recipient_signed_prekey_signature)
      ],
      ["recipient_one_time_prekey", encode_binary(session.recipient_one_time_prekey)]
    ]
  end

  defp normalize_bootstrap_attrs(attrs) do
    case Map.get(attrs, "initiator_ephemeral_keys") do
      nil ->
        {:ok, %{initiator_ephemeral_keys: %{}}}

      initiator_ephemeral_keys when is_map(initiator_ephemeral_keys) ->
        initiator_ephemeral_keys
        |> Enum.reduce_while({:ok, %{}}, fn
          {device_id, public_key_base64}, {:ok, acc} when is_binary(device_id) ->
            case decode_bootstrap_public_key(device_id, public_key_base64) do
              {:ok, public_key} ->
                {:cont, {:ok, Map.put(acc, device_id, public_key)}}

              {:error, reason} ->
                {:halt, {:error, reason}}
            end

          {_device_id, _public_key_base64}, _acc ->
            {:halt,
             {:error, {:validation, "initiator_ephemeral_keys device ids must be strings."}}}
        end)
        |> case do
          {:ok, decoded} -> {:ok, %{initiator_ephemeral_keys: decoded}}
          {:error, reason} -> {:error, reason}
        end

      _other ->
        {:error, {:validation, "initiator_ephemeral_keys must be an object keyed by device id."}}
    end
  end

  defp decode_bootstrap_public_key(device_id, public_key_base64)
       when is_binary(public_key_base64) do
    case Base.decode64(public_key_base64) do
      {:ok, public_key} ->
        {:ok, public_key}

      :error ->
        {:error,
         {:validation,
          "initiator_ephemeral_keys.#{device_id} must be a base64-encoded public key."}}
    end
  end

  defp decode_bootstrap_public_key(device_id, _public_key_base64) do
    {:error,
     {:validation, "initiator_ephemeral_keys.#{device_id} must be a base64-encoded public key."}}
  end

  defp require_initiator_ephemeral_public_key(nil, recipient_device_id) do
    {:error,
     {:validation,
      "initiator_ephemeral_keys must include a public key for recipient device #{recipient_device_id}."}}
  end

  defp require_initiator_ephemeral_public_key(public_key, _recipient_device_id),
    do: {:ok, public_key}

  defp maybe_refresh_initiator_ephemeral_public_key(
         %ChatDeviceSession{} = session,
         nil,
         _recipient_device_id
       ) do
    {:ok, session}
  end

  defp maybe_refresh_initiator_ephemeral_public_key(
         %ChatDeviceSession{established_at: %DateTime{}} = session,
         _desired_initiator_ephemeral_public_key,
         _recipient_device_id
       ) do
    {:ok, session}
  end

  defp maybe_refresh_initiator_ephemeral_public_key(
         %ChatDeviceSession{} = session,
         desired_initiator_ephemeral_public_key,
         recipient_device_id
       ) do
    if session.initiator_ephemeral_public_key == desired_initiator_ephemeral_public_key do
      {:ok, session}
    else
      with {:ok, initiator_ephemeral_public_key} <-
             require_initiator_ephemeral_public_key(
               desired_initiator_ephemeral_public_key,
               recipient_device_id
             ) do
        session
        |> ChatDeviceSession.changeset(%{
          initiator_ephemeral_public_key: initiator_ephemeral_public_key
        })
        |> Repo.update()
      end
    end
  end

  defp normalize_message_attrs(attrs) do
    with {:ok, client_id} <- fetch_string(attrs, "client_id", "client id"),
         {:ok, ciphertext} <- fetch_base64(attrs, "ciphertext", "ciphertext"),
         {:ok, header} <- fetch_optional_base64(attrs, "header"),
         {:ok, message_kind} <- fetch_string(attrs, "message_kind", "message kind"),
         {:ok, crypto_scheme} <- fetch_optional_string(attrs, "crypto_scheme"),
         {:ok, sender_key_id} <- fetch_optional_string(attrs, "sender_key_id"),
         {:ok, sender_key_epoch} <- fetch_optional_integer(attrs, "sender_key_epoch"),
         {:ok, group_transport_fallback} <-
           fetch_optional_boolean(attrs, "group_transport_fallback"),
         {:ok, reply_to_message_id} <- fetch_optional_string(attrs, "reply_to_message_id"),
         {:ok, recipient_envelopes} <- fetch_optional_recipient_envelopes(attrs),
         {:ok, established_session_ids} <-
           fetch_optional_id_list(attrs, "established_session_ids") do
      {:ok,
       %{
         client_id: client_id,
         ciphertext: ciphertext,
         header: header,
         message_kind: message_kind,
         crypto_scheme: crypto_scheme,
         sender_key_id: sender_key_id,
         sender_key_epoch: sender_key_epoch,
         group_transport_fallback: group_transport_fallback,
         reply_to_message_id: reply_to_message_id,
         recipient_envelopes: recipient_envelopes,
         established_session_ids: established_session_ids
       }}
    end
  end

  defp build_message_changeset(chat_id, sender_device_id, normalized) do
    %Message{chat_id: chat_id, sender_device_id: sender_device_id}
    |> Message.changeset(%{
      client_id: normalized.client_id,
      header: normalized.header,
      ciphertext: normalized.ciphertext,
      message_kind: normalized.message_kind,
      crypto_scheme: normalized.crypto_scheme,
      sender_key_id: normalized.sender_key_id,
      sender_key_epoch: normalized.sender_key_epoch,
      reply_to_message_id: normalized.reply_to_message_id
    })
  end

  defp recipient_device_ids(chat_id) do
    ids =
      from(chat_member in ChatMember,
        join: device in Device,
        on: device.user_id == chat_member.user_id and is_nil(device.revoked_at),
        where: chat_member.chat_id == ^chat_id,
        select: device.id
      )
      |> Repo.all()

    {:ok, ids}
  end

  defp ensure_group_message_transport(
         %Chat{type: "group", id: chat_id},
         sender_device_id,
         normalized,
         recipient_device_ids
       )
       when is_map(normalized) and is_list(recipient_device_ids) do
    fallback? = Map.get(normalized, :group_transport_fallback, false)
    crypto_scheme = normalize_string(Map.get(normalized, :crypto_scheme))

    cond do
      crypto_scheme == "group_sender_key_v1" ->
        with {:ok, sender_key_id} <-
               require_present_string(Map.get(normalized, :sender_key_id), "sender_key_id"),
             {:ok, sender_key_epoch} <-
               require_non_negative_integer(
                 Map.get(normalized, :sender_key_epoch),
                 "sender_key_epoch"
               ),
             :ok <- ensure_nil_or_empty_map(Map.get(normalized, :recipient_envelopes)),
             :ok <-
               ensure_sender_key_distribution_coverage(
                 chat_id,
                 sender_device_id,
                 sender_key_id,
                 sender_key_epoch,
                 recipient_device_ids
               ) do
          :ok
        end

      fallback? ->
        :ok

      true ->
        {:error,
         {:validation,
          "Group messages must use crypto_scheme=group_sender_key_v1 unless group_transport_fallback=true."}}
    end
  end

  defp ensure_group_message_transport(
         %Chat{},
         _sender_device_id,
         _normalized,
         _recipient_device_ids
       ),
       do: :ok

  defp ensure_sender_key_distribution_coverage(
         chat_id,
         owner_device_id,
         sender_key_id,
         sender_key_epoch,
         recipient_device_ids
       ) do
    required_recipient_ids =
      recipient_device_ids
      |> Enum.reject(&(&1 == owner_device_id))
      |> Enum.uniq()

    if required_recipient_ids == [] do
      :ok
    else
      distributed_ids =
        from(group_sender_key in GroupSenderKey,
          where:
            group_sender_key.chat_id == ^chat_id and
              group_sender_key.owner_device_id == ^owner_device_id and
              group_sender_key.key_id == ^sender_key_id and
              group_sender_key.sender_key_epoch == ^sender_key_epoch and
              group_sender_key.status == "active" and
              group_sender_key.recipient_device_id in ^required_recipient_ids,
          select: group_sender_key.recipient_device_id,
          distinct: true
        )
        |> Repo.all()
        |> MapSet.new()

      expected_ids = MapSet.new(required_recipient_ids)

      if MapSet.equal?(distributed_ids, expected_ids) do
        :ok
      else
        {:error,
         {:validation,
          "Sender key distribution is incomplete for active recipient devices in this group chat."}}
      end
    end
  end

  defp require_present_string(value, field_name) when is_binary(field_name) do
    case normalize_string(value) do
      nil -> {:error, {:validation, "#{field_name} is required."}}
      normalized -> {:ok, normalized}
    end
  end

  defp require_non_negative_integer(value, field_name) when is_binary(field_name) do
    cond do
      is_integer(value) and value >= 0 ->
        {:ok, value}

      true ->
        {:error, {:validation, "#{field_name} must be a non-negative integer."}}
    end
  end

  defp ensure_nil_or_empty_map(nil), do: :ok
  defp ensure_nil_or_empty_map(map) when is_map(map) and map_size(map) == 0, do: :ok

  defp ensure_nil_or_empty_map(_other) do
    {:error,
     {:validation,
      "recipient_envelopes is not supported for group sender-key encrypted messages."}}
  end

  defp insert_recipient_envelopes(_repo, _message, [], _ciphertext, _recipient_envelopes),
    do: {:ok, []}

  defp insert_recipient_envelopes(
         repo,
         %Message{} = message,
         recipient_device_ids,
         ciphertext,
         recipient_envelopes
       ) do
    with {:ok, envelope_payloads} <-
           resolve_recipient_payloads(recipient_device_ids, ciphertext, recipient_envelopes) do
      Enum.reduce_while(envelope_payloads, {:ok, []}, fn {device_id, payload}, {:ok, inserted} ->
        message
        |> Ecto.build_assoc(:recipient_envelopes, device_id: device_id)
        |> MessageRecipient.changeset(%{ciphertext_for_device: payload})
        |> repo.insert()
        |> case do
          {:ok, envelope} -> {:cont, {:ok, [envelope | inserted]}}
          {:error, changeset} -> {:halt, {:error, changeset}}
        end
      end)
      |> case do
        {:ok, inserted} -> {:ok, Enum.reverse(inserted)}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp mark_established_sessions(_repo, _chat_id, _sender_device_id, []), do: {:ok, []}

  defp mark_established_sessions(repo, chat_id, sender_device_id, established_session_ids) do
    session_ids =
      established_session_ids
      |> Enum.uniq()

    matching_sessions =
      from(session in ChatDeviceSession,
        where:
          session.chat_id == ^chat_id and session.initiator_device_id == ^sender_device_id and
            session.id in ^session_ids and session.status == "active" and
            is_nil(session.superseded_at)
      )
      |> repo.all()

    if length(matching_sessions) != length(session_ids) do
      {:error,
       {:validation,
        "established_session_ids must reference active chat sessions initiated by this device."}}
    else
      now = DateTime.utc_now()

      {updated_count, _} =
        from(session in ChatDeviceSession,
          where:
            session.id in ^session_ids and is_nil(session.established_at) and
              is_nil(session.superseded_at)
        )
        |> repo.update_all(set: [established_at: now])

      {:ok, %{session_count: length(session_ids), newly_established_count: updated_count}}
    end
  end

  defp resolve_recipient_payloads(recipient_device_ids, ciphertext, nil) do
    payloads = Enum.map(recipient_device_ids, &{&1, ciphertext})
    {:ok, payloads}
  end

  defp resolve_recipient_payloads(recipient_device_ids, _ciphertext, recipient_envelopes) do
    recipient_ids = MapSet.new(recipient_device_ids)
    provided_ids = MapSet.new(Map.keys(recipient_envelopes))

    cond do
      not MapSet.subset?(provided_ids, recipient_ids) ->
        {:error, {:validation, "recipient_envelopes contains an unknown device id."}}

      not MapSet.equal?(provided_ids, recipient_ids) ->
        {:error, {:validation, "recipient_envelopes must include every active recipient device."}}

      true ->
        Enum.reduce_while(recipient_envelopes, {:ok, []}, fn {device_id, payload},
                                                             {:ok, inserted} ->
          if MapSet.member?(recipient_ids, device_id) do
            {:cont, {:ok, [{device_id, payload} | inserted]}}
          else
            {:halt, {:error, {:validation, "recipient_envelopes contains an unknown device id."}}}
          end
        end)
        |> case do
          {:ok, inserted} -> {:ok, Enum.reverse(inserted)}
          {:error, reason} -> {:error, reason}
        end
    end
  end

  defp member_query do
    from(chat_member in ChatMember,
      preload: [:user]
    )
  end

  defp recipient_query do
    from(message_recipient in MessageRecipient)
  end

  defp reaction_query do
    from(message_reaction in MessageReaction)
  end

  defp hydrate_chat_summary(%Chat{} = chat, current_user_id) do
    summary =
      from(message in Message,
        where: message.chat_id == ^chat.id,
        select: %{
          message_count: count(message.id),
          latest_message_at: max(message.inserted_at)
        }
      )
      |> Repo.one()

    chat
    |> Map.from_struct()
    |> Map.take([:id, :type, :members, :metadata_encrypted])
    |> Map.put(:message_count, summary.message_count)
    |> Map.put(:latest_message_at, summary.latest_message_at)
    |> present_chat(current_user_id)
  end

  defp present_chat_with_preloaded_members(%Chat{} = chat, current_user_id) do
    chat
    |> Repo.preload(members: [:user])
    |> Map.from_struct()
    |> Map.take([:id, :type, :inserted_at, :updated_at, :members, :metadata_encrypted])
    |> Map.put(:message_count, 0)
    |> Map.put(:latest_message_at, nil)
    |> present_chat(current_user_id)
  end

  defp present_chat(chat, current_user_id) do
    member_entries =
      chat.members
      |> Enum.map(fn member ->
        %{
          user_id: chat_member_user_id(member),
          username: chat_member_username(member)
        }
      end)

    other_members =
      member_entries
      |> Enum.reject(&(&1.user_id == current_user_id))
      |> Enum.map(& &1.username)
      |> Enum.reject(&is_nil/1)

    participant_ids = Enum.map(member_entries, & &1.user_id)

    participant_names =
      member_entries
      |> Enum.map(& &1.username)
      |> Enum.reject(&is_nil/1)

    title =
      cond do
        chat.type == "group" ->
          decode_chat_title(chat.metadata_encrypted) || "Group chat"

        chat.type == "channel" ->
          decode_chat_title(chat.metadata_encrypted) || "Channel"

        length(participant_ids) == 1 and Enum.at(participant_ids, 0) == current_user_id ->
          "Saved Messages"

        other_members == [] ->
          "Direct chat"

        true ->
          Enum.join(other_members, ", ")
      end

    %{
      id: chat.id,
      type: chat.type,
      title: title,
      participant_usernames: participant_names,
      is_self_chat:
        length(participant_ids) == 1 and Enum.at(participant_ids, 0) == current_user_id,
      latest_message_at: iso_or_nil(chat.latest_message_at),
      message_count: chat.message_count
    }
  end

  defp present_group_member(%ChatMember{} = chat_member) do
    %{
      user_id: chat_member.user_id,
      username: chat_member_username(chat_member),
      role: chat_member.role,
      joined_at: iso_or_nil(chat_member.joined_at)
    }
  end

  defp present_group_sender_key(%GroupSenderKey{} = group_sender_key) do
    %{
      id: group_sender_key.id,
      chat_id: group_sender_key.chat_id,
      owner_device_id: group_sender_key.owner_device_id,
      recipient_device_id: group_sender_key.recipient_device_id,
      key_id: group_sender_key.key_id,
      sender_key_epoch: group_sender_key.sender_key_epoch,
      algorithm: group_sender_key.algorithm,
      status: group_sender_key.status,
      wrapped_sender_key: Base.encode64(group_sender_key.wrapped_sender_key),
      inserted_at: iso_or_nil(group_sender_key.inserted_at),
      updated_at: iso_or_nil(group_sender_key.updated_at)
    }
  end

  defp present_message(message, current_device_id, current_user_id) do
    current_recipient_envelope =
      Enum.find(message.recipient_envelopes, &(&1.device_id == current_device_id))

    %{
      id: message.id,
      chat_id: message.chat_id,
      client_id: message.client_id,
      message_kind: message.message_kind,
      crypto_scheme: message.crypto_scheme,
      sender_key_id: message.sender_key_id,
      sender_key_epoch: message.sender_key_epoch,
      sender_device_id: message.sender_device_id,
      inserted_at: DateTime.to_iso8601(message.inserted_at),
      pinned_at: iso_or_nil(message.pinned_at),
      header: encode_binary(message.header),
      ciphertext: Base.encode64(message.ciphertext),
      reply_to_message_id: message.reply_to_message_id,
      edited_at: iso_or_nil(message.edited_at),
      deleted_at: iso_or_nil(message.deleted_at),
      recipient_device_ids: Enum.map(message.recipient_envelopes, & &1.device_id),
      reactions: summarize_reactions(Map.get(message, :reactions, []), current_user_id),
      recipient_envelope:
        encode_binary(
          current_recipient_envelope && current_recipient_envelope.ciphertext_for_device
        )
    }
  end

  defp summarize_reactions(reactions, current_user_id) when is_list(reactions) do
    reactions
    |> Enum.group_by(& &1.reaction_key)
    |> Enum.map(fn {reaction_key, entries} ->
      %{
        reaction_key: reaction_key,
        count: length(entries),
        reacted: Enum.any?(entries, &(&1.user_id == current_user_id))
      }
    end)
    |> Enum.sort_by(&{&1.reaction_key, &1.count})
  end

  defp summarize_reactions(_, _current_user_id), do: []

  defp chat_member_username(%ChatMember{user: %User{username: username}}), do: username
  defp chat_member_username(%{user: %User{username: username}}), do: username
  defp chat_member_username(_), do: nil

  defp chat_member_user_id(%ChatMember{user_id: user_id}), do: user_id
  defp chat_member_user_id(%{user_id: user_id}), do: user_id
  defp chat_member_user_id(_), do: nil

  defp direct_key(left_user_id, right_user_id) do
    [left_user_id, right_user_id]
    |> Enum.sort()
    |> Enum.join(":")
  end

  defp fetch_string(attrs, key, label) do
    case attrs |> Map.get(key) |> normalize_string() do
      nil -> {:error, {:validation, "#{label} is required."}}
      value -> {:ok, value}
    end
  end

  defp fetch_optional_string(attrs, key) do
    {:ok, attrs |> Map.get(key) |> normalize_string()}
  end

  defp fetch_optional_integer(attrs, key) do
    case Map.get(attrs, key) do
      nil ->
        {:ok, nil}

      value when is_integer(value) and value >= 0 ->
        {:ok, value}

      value when is_binary(value) ->
        case Integer.parse(String.trim(value)) do
          {parsed, ""} when parsed >= 0 -> {:ok, parsed}
          _ -> {:error, {:validation, "#{key} must be a non-negative integer."}}
        end

      _other ->
        {:error, {:validation, "#{key} must be a non-negative integer."}}
    end
  end

  defp fetch_optional_boolean(attrs, key) do
    case Map.get(attrs, key) do
      nil ->
        {:ok, false}

      value when value in [true, false] ->
        {:ok, value}

      value when is_binary(value) ->
        case String.downcase(String.trim(value)) do
          "true" -> {:ok, true}
          "false" -> {:ok, false}
          _ -> {:error, {:validation, "#{key} must be a boolean."}}
        end

      _other ->
        {:error, {:validation, "#{key} must be a boolean."}}
    end
  end

  defp fetch_base64(attrs, key, label) do
    case attrs |> Map.get(key) |> normalize_string() do
      nil ->
        {:error, {:validation, "#{label} is required."}}

      value ->
        case Base.decode64(value) do
          {:ok, decoded} -> {:ok, decoded}
          :error -> {:error, {:validation, "#{label} must be valid base64."}}
        end
    end
  end

  defp fetch_optional_base64(attrs, key) do
    case attrs |> Map.get(key) |> normalize_string() do
      nil ->
        {:ok, nil}

      value ->
        case Base.decode64(value) do
          {:ok, decoded} -> {:ok, decoded}
          :error -> {:error, {:validation, "#{key} must be valid base64."}}
        end
    end
  end

  defp fetch_optional_recipient_envelopes(attrs) do
    case Map.get(attrs, "recipient_envelopes") do
      nil ->
        {:ok, nil}

      recipient_envelopes when is_map(recipient_envelopes) ->
        Enum.reduce_while(recipient_envelopes, {:ok, %{}}, fn
          {device_id, payload_base64}, {:ok, decoded} when is_binary(device_id) ->
            case normalize_string(payload_base64) do
              nil ->
                {:halt,
                 {:error,
                  {:validation, "recipient_envelopes values must be valid base64 strings."}}}

              payload ->
                case Base.decode64(payload) do
                  {:ok, decoded_payload} ->
                    {:cont, {:ok, Map.put(decoded, device_id, decoded_payload)}}

                  :error ->
                    {:halt,
                     {:error,
                      {:validation, "recipient_envelopes values must be valid base64 strings."}}}
                end
            end

          _, _acc ->
            {:halt, {:error, {:validation, "recipient_envelopes must be a map of device ids."}}}
        end)

      _ ->
        {:error, {:validation, "recipient_envelopes must be a map of device ids."}}
    end
  end

  defp fetch_optional_id_list(attrs, key) do
    case Map.get(attrs, key) do
      nil ->
        {:ok, []}

      values when is_list(values) ->
        values
        |> Enum.reduce_while({:ok, []}, fn
          value, {:ok, acc} ->
            case normalize_string(value) do
              nil ->
                {:halt, {:error, {:validation, "#{key} must contain valid ids."}}}

              normalized ->
                {:cont, {:ok, [normalized | acc]}}
            end
        end)
        |> case do
          {:ok, ids} -> {:ok, Enum.reverse(ids)}
          {:error, reason} -> {:error, reason}
        end

      _ ->
        {:error, {:validation, "#{key} must be a list of ids."}}
    end
  end

  defp normalize_sender_key_distribution(attrs) do
    with {:ok, key_id} <- fetch_string(attrs, "key_id", "sender key id"),
         {:ok, sender_key_epoch} <- fetch_optional_integer(attrs, "sender_key_epoch"),
         {:ok, wrapped_sender_keys} <- fetch_sender_key_map(attrs, "wrapped_keys"),
         {:ok, algorithm} <- fetch_optional_string(attrs, "algorithm"),
         {:ok, recipient_wrapped_keys} <- decode_sender_key_map(wrapped_sender_keys) do
      recipient_device_ids = recipient_wrapped_keys |> Enum.map(&elem(&1, 0)) |> Enum.uniq()

      {:ok,
       %{
         key_id: key_id,
         sender_key_epoch: sender_key_epoch || 0,
         algorithm: algorithm || "p256-ecdh+a256gcm",
         recipient_device_ids: recipient_device_ids,
         recipient_wrapped_keys: recipient_wrapped_keys
       }}
    end
  end

  defp fetch_sender_key_map(attrs, key) do
    case Map.get(attrs, key) do
      map when is_map(map) and map_size(map) > 0 ->
        if Enum.all?(map, fn {map_key, _value} -> is_binary(map_key) end) do
          {:ok, map}
        else
          {:error, {:validation, "#{key} must be keyed by recipient device id strings."}}
        end

      _ ->
        {:error, {:validation, "#{key} must be a non-empty object keyed by recipient device id."}}
    end
  end

  defp decode_sender_key_map(sender_key_map) when is_map(sender_key_map) do
    sender_key_map
    |> Enum.reduce_while({:ok, []}, fn {recipient_device_id, wrapped_sender_key_base64},
                                       {:ok, decoded} ->
      case decode_sender_key_payload(recipient_device_id, wrapped_sender_key_base64) do
        {:ok, wrapped_sender_key} ->
          {:cont, {:ok, [{recipient_device_id, wrapped_sender_key} | decoded]}}

        {:error, reason} ->
          {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, decoded} -> {:ok, Enum.reverse(decoded)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp decode_sender_key_payload(recipient_device_id, wrapped_sender_key_base64)
       when is_binary(recipient_device_id) and is_binary(wrapped_sender_key_base64) do
    case Base.decode64(wrapped_sender_key_base64) do
      {:ok, wrapped_sender_key} ->
        {:ok, wrapped_sender_key}

      :error ->
        {:error,
         {:validation,
          "wrapped_keys.#{recipient_device_id} must be a base64-encoded wrapped sender key."}}
    end
  end

  defp decode_sender_key_payload(recipient_device_id, _wrapped_sender_key_base64)
       when is_binary(recipient_device_id) do
    {:error,
     {:validation,
      "wrapped_keys.#{recipient_device_id} must be a base64-encoded wrapped sender key."}}
  end

  defp resolve_group_sender_key_recipients(chat_id, recipient_device_ids)
       when is_list(recipient_device_ids) do
    recipient_device_ids = Enum.uniq(recipient_device_ids)

    devices =
      from(chat_member in ChatMember,
        join: device in Device,
        on: device.user_id == chat_member.user_id and is_nil(device.revoked_at),
        where: chat_member.chat_id == ^chat_id and device.id in ^recipient_device_ids,
        select: device.id
      )
      |> Repo.all()
      |> MapSet.new()

    expected = MapSet.new(recipient_device_ids)

    if MapSet.equal?(devices, expected) do
      {:ok, recipient_device_ids}
    else
      {:error,
       {:validation,
        "wrapped_keys must only contain active recipient devices in this group chat."}}
    end
  end

  defp resolve_safety_peer_device(chat_id, peer_device_id) do
    from(chat_member in ChatMember,
      join: user in User,
      on: user.id == chat_member.user_id,
      join: device in Device,
      on:
        device.user_id == chat_member.user_id and is_nil(device.revoked_at) and
          not is_nil(device.identity_public_key),
      where: chat_member.chat_id == ^chat_id and device.id == ^peer_device_id,
      select: %{
        user_id: user.id,
        username: user.username,
        device_id: device.id,
        device_name: device.device_name,
        identity_public_key: device.identity_public_key
      },
      limit: 1
    )
    |> Repo.one()
    |> case do
      nil -> {:error, {:not_found, "Peer device is not available in this chat."}}
      peer -> {:ok, peer}
    end
  end

  defp ensure_device_belongs_to_user(%Device{user_id: user_id}, user_id), do: :ok

  defp ensure_device_belongs_to_user(_device, _user_id),
    do: {:error, {:unauthorized, "Verifier device does not belong to the authenticated user."}}

  defp ensure_not_self_safety_device(device_id, device_id),
    do: {:error, {:validation, "Cannot verify the active device fingerprint against itself."}}

  defp ensure_not_self_safety_device(_left, _right), do: :ok

  defp safety_number_fingerprint(local_identity_public_key, remote_identity_public_key)
       when is_binary(local_identity_public_key) and is_binary(remote_identity_public_key) do
    [left, right] = Enum.sort([local_identity_public_key, remote_identity_public_key])

    <<digest::binary-size(32)>> = :crypto.hash(:sha256, left <> right)

    digits =
      digest
      |> :binary.bin_to_list()
      |> Enum.map(&(Integer.to_string(rem(&1, 100)) |> String.pad_leading(2, "0")))
      |> Enum.join("")
      |> binary_part(0, 30)

    digits
    |> String.codepoints()
    |> Enum.chunk_every(5)
    |> Enum.map_join(" ", &Enum.join/1)
  end

  defp normalize_string(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_string(_), do: nil

  defp fetch_username_list(attrs, key) do
    case Map.get(attrs, key) do
      nil ->
        {:ok, []}

      usernames when is_list(usernames) ->
        usernames
        |> Enum.reduce_while({:ok, []}, fn
          username, {:ok, acc} ->
            case normalize_string(username) do
              nil -> {:halt, {:error, {:validation, "#{key} must contain valid usernames."}}}
              normalized -> {:cont, {:ok, [normalized | acc]}}
            end
        end)
        |> case do
          {:ok, normalized} -> {:ok, normalized |> Enum.reverse() |> Enum.uniq()}
          {:error, reason} -> {:error, reason}
        end

      _ ->
        {:error, {:validation, "#{key} must be a list of usernames."}}
    end
  end

  defp resolve_group_members(%User{} = current_user, member_usernames) do
    usernames =
      [current_user.username | member_usernames]
      |> Enum.uniq()

    users =
      from(user in User, where: user.username in ^usernames)
      |> Repo.all()

    users_by_username = Map.new(users, &{&1.username, &1})

    missing_usernames = Enum.reject(usernames, &Map.has_key?(users_by_username, &1))

    if missing_usernames == [] do
      members =
        Enum.map(usernames, fn username ->
          role = if username == current_user.username, do: "admin", else: "member"
          {Map.fetch!(users_by_username, username), role}
        end)

      {:ok, members}
    else
      {:error, {:not_found, "One or more group members were not found."}}
    end
  end

  defp encode_binary(nil), do: nil
  defp encode_binary(value), do: Base.encode64(value)

  defp iso_or_nil(nil), do: nil
  defp iso_or_nil(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp iso_or_nil(value), do: value

  defp decode_chat_title(nil), do: nil
  defp decode_chat_title(value) when is_binary(value), do: String.trim(value)

  defp ensure_message_chat(%Message{chat_id: chat_id}, chat_id), do: :ok

  defp ensure_message_chat(%Message{}, _chat_id),
    do: {:error, {:not_found, "Message not found in this chat."}}

  defp ensure_message_owner(%Message{sender_device_id: sender_device_id}, sender_device_id),
    do: :ok

  defp ensure_message_owner(%Message{}, _sender_device_id),
    do: {:error, {:validation, "Only the sending device can modify this message."}}

  defp ensure_message_edit_permission(_chat, _membership, %Message{} = message, sender_device_id) do
    ensure_message_owner(message, sender_device_id)
  end

  defp ensure_message_delete_permission(
         %Chat{type: "group"},
         %ChatMember{role: "admin"},
         %Message{},
         _sender_device_id
       ),
       do: :ok

  defp ensure_message_delete_permission(
         _chat,
         _membership,
         %Message{} = message,
         sender_device_id
       ) do
    ensure_message_owner(message, sender_device_id)
  end

  defp ensure_message_pin_permission(%Chat{type: "group"}, %ChatMember{} = membership) do
    ensure_group_admin(membership)
  end

  defp ensure_message_pin_permission(%Chat{}, %ChatMember{}), do: :ok

  defp ensure_group_admin(%ChatMember{role: "admin"}), do: :ok

  defp ensure_group_admin(%ChatMember{}),
    do: {:error, {:validation, "Only group admins can update this chat."}}

  defp ensure_group_chat(%Chat{type: "group"}), do: :ok

  defp ensure_group_chat(%Chat{}),
    do: {:error, {:validation, "Only group chats support this action."}}

  defp ensure_admin_continuity(_chat_id, %ChatMember{role: "member"}, _next_role), do: :ok
  defp ensure_admin_continuity(_chat_id, %ChatMember{role: "admin"}, "admin"), do: :ok

  defp ensure_admin_continuity(chat_id, %ChatMember{role: "admin", user_id: user_id}, _next_role) do
    remaining_admin_count =
      from(chat_member in ChatMember,
        where:
          chat_member.chat_id == ^chat_id and chat_member.role == "admin" and
            chat_member.user_id != ^user_id,
        select: count(chat_member.id)
      )
      |> Repo.one()

    if remaining_admin_count > 0 do
      :ok
    else
      {:error, {:validation, "A group must keep at least one admin."}}
    end
  end

  defp ensure_not_deleted(%Message{deleted_at: nil}), do: :ok
  defp ensure_not_deleted(%Message{}), do: {:error, {:validation, "Message is already deleted."}}

  defp ensure_pinnable(%Message{message_kind: "system"}),
    do: {:error, {:validation, "System messages cannot be pinned."}}

  defp ensure_pinnable(%Message{}), do: :ok

  defp validate_reply_target(_chat_id, nil), do: {:ok, nil}

  defp validate_reply_target(chat_id, reply_to_message_id) when is_binary(reply_to_message_id) do
    case Repo.get(Message, reply_to_message_id) do
      %Message{chat_id: ^chat_id} = message -> {:ok, message}
      %Message{} -> {:error, {:validation, "Reply target must belong to this chat."}}
      nil -> {:error, {:not_found, "Reply target not found."}}
    end
  end

  defp fetch_group_role(attrs) do
    with {:ok, role} <- fetch_string(attrs, "role", "group role"),
         :ok <- validate_group_role(role) do
      {:ok, role}
    end
  end

  defp validate_group_role("admin"), do: :ok
  defp validate_group_role("member"), do: :ok

  defp validate_group_role(_role),
    do: {:error, {:validation, "group role must be admin or member."}}

  defp format_changeset_error(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
    |> Enum.map(fn {field, [message | _]} -> "#{field} #{message}" end)
    |> List.first()
    |> Kernel.||("The record could not be saved.")
  end

  defp maybe_queue_federation_message(chat_id, message)
       when is_binary(chat_id) and is_map(message) do
    payload = federation_message_payload(chat_id, message)

    case Federation.queue_outbound_message(chat_id, payload) do
      :ok -> :ok
      _other -> :ok
    end
  rescue
    _error -> :ok
  end

  defp federation_message_payload(chat_id, message) do
    recipient_envelopes =
      message
      |> Map.get(:recipient_envelopes, [])
      |> Enum.reduce(%{}, fn recipient, acc ->
        case recipient do
          %{device_id: device_id, ciphertext_for_device: ciphertext_for_device}
          when is_binary(device_id) and is_binary(ciphertext_for_device) ->
            Map.put(acc, device_id, Base.encode64(ciphertext_for_device))

          _other ->
            acc
        end
      end)

    %{
      "chat_id" => chat_id,
      "message_id" => Map.get(message, :id),
      "client_id" => Map.get(message, :client_id),
      "message_kind" => Map.get(message, :message_kind),
      "crypto_scheme" => Map.get(message, :crypto_scheme),
      "sender_key_id" => Map.get(message, :sender_key_id),
      "sender_key_epoch" => Map.get(message, :sender_key_epoch),
      "sender_device_id" => Map.get(message, :sender_device_id),
      "header" => encode_binary(Map.get(message, :header)),
      "ciphertext" =>
        case Map.get(message, :ciphertext) do
          value when is_binary(value) -> Base.encode64(value)
          _ -> nil
        end,
      "reply_to_message_id" => Map.get(message, :reply_to_message_id),
      "recipient_envelopes" => recipient_envelopes,
      "inserted_at" => iso_or_nil(Map.get(message, :inserted_at))
    }
  end

  defp broadcast_message(chat_id, message_id) do
    Endpoint.broadcast("chat:#{chat_id}", "message:new", %{
      chat_id: chat_id,
      message_id: message_id
    })
  end
end
