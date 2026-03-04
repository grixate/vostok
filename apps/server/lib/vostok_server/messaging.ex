defmodule VostokServer.Messaging do
  @moduledoc """
  Stage 3 messaging context for direct chats and opaque message envelopes.
  """

  import Ecto.Query

  alias Ecto.Multi
  alias VostokServer.Identity.{Device, OneTimePrekey, User}

  alias VostokServer.Messaging.{
    Chat,
    ChatDeviceSession,
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

  def create_message(chat_id, sender_device_id, user_id, attrs, current_device_id)
      when is_binary(chat_id) and is_binary(sender_device_id) and is_binary(user_id) and
             is_binary(current_device_id) and is_map(attrs) do
    with {:ok, _membership} <- ensure_membership(chat_id, user_id),
         {:ok, normalized} <- normalize_message_attrs(attrs),
         {:ok, _reply_target} <- validate_reply_target(chat_id, normalized.reply_to_message_id),
         {:ok, recipient_device_ids} <- recipient_device_ids(chat_id) do
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
              :client_id,
              :message_kind,
              :sender_device_id,
              :inserted_at,
              :header,
              :ciphertext,
              :reply_to_message_id,
              :recipient_envelopes,
              :reactions
            ])

          presented_message = present_message(message, current_device_id, user_id)
          broadcast_message(chat_id, message.id)

          {:ok, presented_message}

        {:error, _step, reason, _changes} ->
          {:error, reason}
      end
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

  def toggle_message_reaction(chat_id, message_id, user_id, current_device_id, attrs)
      when is_binary(chat_id) and is_binary(message_id) and is_binary(user_id) and
             is_binary(current_device_id) and is_map(attrs) do
    with {:ok, _membership} <- ensure_membership(chat_id, user_id),
         {:ok, reaction_key} <- fetch_string(attrs, "reaction_key", "reaction key"),
         %Message{} = message <- Repo.get(Message, message_id),
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

  defp ensure_chat_device_session(
         chat_id,
         %Device{} = initiator,
         %Device{} = recipient,
         self_session?,
         initiator_ephemeral_keys
       ) do
    desired_initiator_ephemeral_public_key = Map.get(initiator_ephemeral_keys, recipient.id)

    case Repo.get_by(ChatDeviceSession,
           chat_id: chat_id,
           initiator_device_id: initiator.id,
           recipient_device_id: recipient.id
         ) do
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
          recipient_one_time_prekey_record =
            if self_session? do
              nil
            else
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
         {:ok, reply_to_message_id} <- fetch_optional_string(attrs, "reply_to_message_id"),
         {:ok, recipient_envelopes} <- fetch_optional_recipient_envelopes(attrs) do
      {:ok,
       %{
         client_id: client_id,
         ciphertext: ciphertext,
         header: header,
         message_kind: message_kind,
         reply_to_message_id: reply_to_message_id,
         recipient_envelopes: recipient_envelopes
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

  defp resolve_recipient_payloads(recipient_device_ids, ciphertext, nil) do
    payloads = Enum.map(recipient_device_ids, &{&1, ciphertext})
    {:ok, payloads}
  end

  defp resolve_recipient_payloads(recipient_device_ids, _ciphertext, recipient_envelopes) do
    recipient_ids = MapSet.new(recipient_device_ids)

    Enum.reduce_while(recipient_envelopes, {:ok, []}, fn {device_id, payload}, {:ok, inserted} ->
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

  defp present_message(message, current_device_id, current_user_id) do
    current_recipient_envelope =
      Enum.find(message.recipient_envelopes, &(&1.device_id == current_device_id))

    %{
      id: message.id,
      client_id: message.client_id,
      message_kind: message.message_kind,
      sender_device_id: message.sender_device_id,
      inserted_at: DateTime.to_iso8601(message.inserted_at),
      header: encode_binary(message.header),
      ciphertext: Base.encode64(message.ciphertext),
      reply_to_message_id: message.reply_to_message_id,
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

  defp validate_reply_target(_chat_id, nil), do: {:ok, nil}

  defp validate_reply_target(chat_id, reply_to_message_id) when is_binary(reply_to_message_id) do
    case Repo.get(Message, reply_to_message_id) do
      %Message{chat_id: ^chat_id} = message -> {:ok, message}
      %Message{} -> {:error, {:validation, "Reply target must belong to this chat."}}
      nil -> {:error, {:not_found, "Reply target not found."}}
    end
  end

  defp broadcast_message(chat_id, message_id) do
    Endpoint.broadcast("chat:#{chat_id}", "message:new", %{
      chat_id: chat_id,
      message_id: message_id
    })
  end
end
