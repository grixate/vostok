defmodule VostokServer.Messaging.Presenter do
  @moduledoc false

  import Ecto.Query

  alias VostokServer.Identity.User

  alias VostokServer.Messaging.{
    Chat,
    ChatMember,
    ChatReadState,
    GroupSenderKey,
    Message,
    MessageReaction,
    MessageRecipient
  }

  alias VostokServer.Repo

  def member_query do
    from(chat_member in ChatMember, preload: [:user])
  end

  def recipient_query do
    from(message_recipient in MessageRecipient)
  end

  def reaction_query do
    from(message_reaction in MessageReaction)
  end

  def hydrate_chat_summary(%Chat{} = chat, current_user_id, device_id) do
    summary =
      from(message in Message,
        where: message.chat_id == ^chat.id,
        select: %{
          message_count: count(message.id),
          latest_message_at: max(message.inserted_at)
        }
      )
      |> Repo.one()

    unread_count =
      if device_id do
        read_state = Repo.get_by(ChatReadState, chat_id: chat.id, device_id: device_id)

        if read_state && read_state.read_at do
          from(m in Message,
            where: m.chat_id == ^chat.id and m.inserted_at > ^read_state.read_at,
            select: count(m.id)
          )
          |> Repo.one()
        else
          summary.message_count
        end
      else
        summary.message_count
      end

    chat
    |> Map.from_struct()
    |> Map.take([:id, :type, :members, :metadata_encrypted])
    |> Map.put(:message_count, unread_count)
    |> Map.put(:latest_message_at, summary.latest_message_at)
    |> present_chat(current_user_id)
  end

  def present_chat_with_preloaded_members(%Chat{} = chat, current_user_id) do
    chat
    |> Repo.preload(members: [:user])
    |> Map.from_struct()
    |> Map.take([:id, :type, :inserted_at, :updated_at, :members, :metadata_encrypted])
    |> Map.put(:message_count, 0)
    |> Map.put(:latest_message_at, nil)
    |> present_chat(current_user_id)
  end

  def present_chat(chat, current_user_id) do
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
      participant_user_ids: participant_ids,
      is_self_chat:
        length(participant_ids) == 1 and Enum.at(participant_ids, 0) == current_user_id,
      latest_message_at: iso_or_nil(chat.latest_message_at),
      message_count: chat.message_count
    }
  end

  def present_group_member(%ChatMember{} = chat_member) do
    %{
      user_id: chat_member.user_id,
      username: chat_member_username(chat_member),
      role: chat_member.role,
      joined_at: iso_or_nil(chat_member.joined_at)
    }
  end

  def present_group_sender_key(%GroupSenderKey{} = group_sender_key) do
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

  def present_message(message, current_device_id, current_user_id) do
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
      sender_username: sender_username_for(message),
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

  def direct_key(left_user_id, right_user_id) do
    [left_user_id, right_user_id]
    |> Enum.sort()
    |> Enum.join(":")
  end

  def encode_binary(nil), do: nil
  def encode_binary(value), do: Base.encode64(value)

  def iso_or_nil(nil), do: nil
  def iso_or_nil(%DateTime{} = value), do: DateTime.to_iso8601(value)
  def iso_or_nil(value), do: value

  def decode_chat_title(nil), do: nil
  def decode_chat_title(value) when is_binary(value), do: String.trim(value)

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

  defp sender_username_for(%{sender_device: %{user: %{username: username}}}), do: username
  defp sender_username_for(_), do: nil

  defp chat_member_username(%ChatMember{user: %User{username: username}}), do: username
  defp chat_member_username(%{user: %User{username: username}}), do: username
  defp chat_member_username(_), do: nil

  defp chat_member_user_id(%ChatMember{user_id: user_id}), do: user_id
  defp chat_member_user_id(%{user_id: user_id}), do: user_id
  defp chat_member_user_id(_), do: nil
end
