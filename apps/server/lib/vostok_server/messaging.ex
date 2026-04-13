defmodule VostokServer.Messaging do
  @moduledoc """
  Stage 3 messaging context for direct chats and opaque message envelopes.
  """

  import Ecto.Query

  import VostokServer.Messaging.Delivery,
    only: [
      broadcast_message: 2,
      maybe_queue_federation_message: 2,
      present_inserted_message: 3,
      present_persisted_message: 3
    ]

  import VostokServer.Messaging.Guards,
    only: [
      ensure_admin_continuity: 3,
      ensure_group_admin: 1,
      ensure_group_chat: 1,
      ensure_message_chat: 2,
      ensure_message_delete_permission: 4,
      ensure_message_edit_permission: 4,
      ensure_message_pin_permission: 2,
      ensure_not_deleted: 1,
      ensure_pinnable: 1,
      fetch_group_role: 2,
      format_changeset_error: 1,
      validate_reply_target: 2
    ]

  import VostokServer.Messaging.Params,
    only: [
      ensure_device_belongs_to_user: 2,
      ensure_not_self_safety_device: 2,
      fetch_base64: 3,
      fetch_optional_base64: 2,
      fetch_optional_boolean: 2,
      fetch_optional_id_list: 2,
      fetch_optional_integer: 2,
      fetch_optional_recipient_envelopes: 1,
      fetch_optional_string: 2,
      fetch_string: 3,
      fetch_username_list: 2,
      normalize_sender_key_distribution: 1,
      normalize_string: 1,
      resolve_group_members: 2,
      resolve_group_sender_key_recipients: 2,
      resolve_safety_peer_device: 2,
      safety_number_fingerprint: 2
    ]

  import VostokServer.Messaging.Presenter,
    only: [
      direct_key: 2,
      encode_binary: 1,
      hydrate_chat_summary: 3,
      iso_or_nil: 1,
      member_query: 0,
      present_chat_with_preloaded_members: 2,
      present_group_member: 1,
      present_group_sender_key: 1,
      present_message: 3,
      reaction_query: 0,
      recipient_query: 0
    ]

  alias Ecto.Multi
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

  @messages_seq_cache_key {__MODULE__, :messages_seq_supported}

  def list_chats_for_user(user_id, device_id \\ nil) when is_binary(user_id) do
    from(chat in Chat,
      join: membership in ChatMember,
      on: membership.chat_id == chat.id,
      where: membership.user_id == ^user_id,
      order_by: [desc: chat.updated_at, desc: chat.inserted_at],
      preload: [members: ^member_query()]
    )
    |> Repo.all()
    |> Enum.map(&hydrate_chat_summary(&1, user_id, device_id))
  end

  def ensure_self_chat(%User{} = user) do
    ensure_direct_chat(user.id, user.username)
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
         {:ok, role} <- fetch_group_role(attrs, &fetch_string/3),
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

  def list_messages_for_chat(chat_id, user_id, current_device_id, opts \\ %{})

  def list_messages_for_chat(chat_id, user_id, current_device_id, opts)
      when is_binary(chat_id) and is_binary(user_id) and is_binary(current_device_id) and
             is_map(opts) do
    limit = parse_positive_integer(opts["limit"], 50)
    before_cursor = opts["before"]
    supports_message_seq? = messages_seq_supported?()

    with {:ok, _membership} <- ensure_membership(chat_id, user_id) do
      # Primary sort by inserted_at + id; seq is a tiebreaker for messages
      # with identical timestamps (ensures causal order within a burst).
      query =
        from(message in Message,
          where: message.chat_id == ^chat_id,
          order_by: ^message_list_order(supports_message_seq?),
          limit: ^(limit + 1),
          preload: [
            recipient_envelopes: ^recipient_query(),
            reactions: ^reaction_query(),
            sender_device: [:user]
          ]
        )

      query =
        if is_binary(before_cursor) and before_cursor != "" do
          case Repo.get(Message, before_cursor) do
            %Message{inserted_at: cursor_time} ->
              from(m in query,
                where:
                  m.inserted_at < ^cursor_time or
                    (m.inserted_at == ^cursor_time and m.id < ^before_cursor)
              )

            nil ->
              query
          end
        else
          query
        end

      rows = Repo.all(query)
      has_more = length(rows) > limit
      page = rows |> Enum.take(limit) |> Enum.reverse()
      presented = Enum.map(page, &present_message(&1, current_device_id, user_id))
      {:ok, %{messages: presented, has_more: has_more}}
    end
  end

  defp parse_positive_integer(nil, default), do: default

  defp parse_positive_integer(value, default) when is_binary(value) do
    case Integer.parse(value) do
      {n, ""} when n > 0 -> min(n, 200)
      _ -> default
    end
  end

  defp parse_positive_integer(value, _default) when is_integer(value) and value > 0,
    do: min(value, 200)

  defp parse_positive_integer(_, default), do: default

  defp maybe_assign_message_seq(multi) do
    if messages_seq_supported?() do
      Multi.run(multi, :assign_seq, fn repo, %{message: message} ->
        {1, [%{seq: seq}]} =
          from(m in Message, where: m.id == ^message.id, select: %{seq: field(m, :seq)})
          |> repo.update_all(set: [seq: dynamic([m], fragment("nextval('messages_chat_seq')"))])

        {:ok, seq}
      end)
    else
      multi
    end
  end

  defp message_list_order(true) do
    [
      desc: dynamic([message], message.inserted_at),
      desc: dynamic([message], fragment("COALESCE(?, 0)", field(message, :seq))),
      desc: dynamic([message], message.id)
    ]
  end

  defp message_list_order(false) do
    [
      desc: dynamic([message], message.inserted_at),
      desc: dynamic([message], message.id)
    ]
  end

  defp messages_seq_supported? do
    case :persistent_term.get(@messages_seq_cache_key, :unknown) do
      :unknown ->
        supported? =
          case Ecto.Adapters.SQL.query(
                 Repo,
                 """
                 SELECT 1
                 FROM information_schema.columns
                 WHERE table_name = 'messages' AND column_name = 'seq'
                 LIMIT 1
                 """,
                 []
               ) do
            {:ok, %{num_rows: 1}} -> true
            _ -> false
          end

        :persistent_term.put(@messages_seq_cache_key, supported?)
        supported?

      supported? ->
        supported?
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
           ensure_message_transport(
             chat,
             sender_device_id,
             normalized,
             recipient_device_ids
           ) do
      Multi.new()
      |> Multi.insert(:message, build_message_changeset(chat_id, sender_device_id, normalized))
      |> maybe_assign_message_seq()
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
          presented_message = present_inserted_message(message, current_device_id, user_id)
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
    ttl_hours = Application.get_env(:vostok_server, :message_ttl_hours, 720)
    expires_at = DateTime.add(DateTime.utc_now(), ttl_hours * 3600, :second)

    Multi.new()
    |> Multi.insert(
      :message,
      %Message{chat_id: chat_id, sender_device_id: sender_device_id}
      |> Message.changeset(%{
        client_id: "system-#{Ecto.UUID.generate()}",
        ciphertext: text,
        message_kind: "system",
        expires_at: expires_at
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
           ensure_message_transport(
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
           ensure_message_transport(
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
          updated_message = present_persisted_message(updated_message, current_device_id, user_id)

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
          deleted_message = present_persisted_message(deleted_message, current_device_id, user_id)

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
        |> present_persisted_message(current_device_id, user_id)
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

        present_persisted_message(message, current_device_id, user_id)
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
      resolved_crypto_scheme = default_crypto_scheme(crypto_scheme, recipient_envelopes)

      {:ok,
       %{
         client_id: client_id,
         ciphertext: ciphertext,
         header: header,
         message_kind: message_kind,
         crypto_scheme: resolved_crypto_scheme,
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
    ttl_hours = Application.get_env(:vostok_server, :message_ttl_hours, 720)
    expires_at = DateTime.add(DateTime.utc_now(), ttl_hours * 3600, :second)

    %Message{chat_id: chat_id, sender_device_id: sender_device_id}
    |> Message.changeset(%{
      client_id: normalized.client_id,
      header: normalized.header,
      ciphertext: normalized.ciphertext,
      message_kind: normalized.message_kind,
      crypto_scheme: normalized.crypto_scheme,
      sender_key_id: normalized.sender_key_id,
      sender_key_epoch: normalized.sender_key_epoch,
      reply_to_message_id: normalized.reply_to_message_id,
      expires_at: expires_at
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

  defp default_crypto_scheme(nil, recipient_envelopes) when is_map(recipient_envelopes) and map_size(recipient_envelopes) > 0,
    do: "signal-v1"

  defp default_crypto_scheme(crypto_scheme, _recipient_envelopes), do: crypto_scheme

  defp ensure_message_transport(
         %Chat{type: "group", id: chat_id},
         sender_device_id,
         normalized,
         recipient_device_ids
       )
       when is_map(normalized) and is_list(recipient_device_ids) do
    crypto_scheme = normalize_string(Map.get(normalized, :crypto_scheme))

    cond do
      crypto_scheme == "signal-v1" ->
        with :ok <- ensure_present_recipient_envelopes(Map.get(normalized, :recipient_envelopes)),
             :ok <- ensure_absent_sender_key_metadata(normalized) do
          :ok
        end

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

      true ->
        {:error,
         {:validation,
          "Group messages must use crypto_scheme=signal-v1. Legacy group_sender_key_v1 is accepted only for backwards compatibility."}}
    end
  end

  defp ensure_message_transport(
         %Chat{},
         _sender_device_id,
         normalized,
         _recipient_device_ids
       ) do
    crypto_scheme = normalize_string(Map.get(normalized, :crypto_scheme))

    cond do
      crypto_scheme == "signal-v1" ->
        with :ok <- ensure_present_recipient_envelopes(Map.get(normalized, :recipient_envelopes)),
             :ok <- ensure_absent_sender_key_metadata(normalized) do
          :ok
        end

      true ->
        {:error, {:validation, "Direct messages must use crypto_scheme=signal-v1."}}
    end
  end

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

  defp ensure_present_recipient_envelopes(map) when is_map(map) and map_size(map) > 0, do: :ok

  defp ensure_present_recipient_envelopes(_value) do
    {:error,
     {:validation,
      "Signal-encrypted messages must include recipient_envelopes for every active recipient device."}}
  end

  defp ensure_absent_sender_key_metadata(normalized) do
    sender_key_id = normalize_string(Map.get(normalized, :sender_key_id))
    sender_key_epoch = Map.get(normalized, :sender_key_epoch)

    if is_nil(sender_key_id) and is_nil(sender_key_epoch) do
      :ok
    else
      {:error,
       {:validation,
        "sender_key_id and sender_key_epoch are only supported for legacy group_sender_key_v1 messages."}}
    end
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
end
