defmodule VostokServer.Messaging.Presenter do
  @moduledoc false

  import Ecto.Query

  alias VostokServer.Identity.User

  alias VostokServer.Messaging.{
    Chat,
    ChatMember,
    ChatReadState,
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
    |> Map.take([
      :id,
      :type,
      :members,
      :metadata_encrypted,
      :description,
      :avatar_path,
      :allow_comments,
      :permissions_json
    ])
    |> Map.put(:message_count, unread_count)
    |> Map.put(:latest_message_at, summary.latest_message_at)
    |> present_chat(current_user_id)
  end

  def present_chat_with_preloaded_members(%Chat{} = chat, current_user_id) do
    chat
    |> Repo.preload(members: [:user])
    |> Map.from_struct()
    |> Map.take([
      :id,
      :type,
      :inserted_at,
      :updated_at,
      :members,
      :metadata_encrypted,
      :description,
      :avatar_path,
      :allow_comments,
      :permissions_json
    ])
    |> Map.put(:message_count, 0)
    |> Map.put(:latest_message_at, nil)
    |> present_chat(current_user_id)
  end

  def present_chat(chat, current_user_id) do
    membership = Enum.find(chat.members, &(chat_member_user_id(&1) == current_user_id))
    membership_role = membership && membership.role
    permissions = normalized_permissions(chat.type, Map.get(chat, :permissions_json))
    member_count = length(chat.members)

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

    participant_ids = visible_participant_ids(chat.type, membership_role, member_entries)
    participant_names = visible_participant_names(chat.type, membership_role, member_entries)

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
      description: Map.get(chat, :description),
      avatar_url: chat_avatar_url(chat),
      participant_usernames: participant_names,
      participant_user_ids: participant_ids,
      is_self_chat:
        length(participant_ids) == 1 and Enum.at(participant_ids, 0) == current_user_id,
      latest_message_at: iso_or_nil(chat.latest_message_at),
      message_count: chat.message_count,
      member_count: member_count,
      membership_role: membership_role,
      allow_comments: Map.get(chat, :allow_comments, true),
      permissions: permissions,
      can_post: can_post?(chat.type, membership_role, permissions),
      can_manage_members: can_manage_members?(chat.type, membership_role, permissions),
      can_edit_info: can_edit_info?(chat.type, membership_role, permissions),
      can_delete_chat: can_delete_chat?(chat.type, membership_role),
      can_leave_chat: can_leave_chat?(chat.type, membership_role)
    }
  end

  def present_group_member(%ChatMember{} = chat_member) do
    %{
      user_id: chat_member.user_id,
      username: chat_member_username(chat_member),
      role: chat_member.role,
      joined_at: iso_or_nil(chat_member.joined_at),
      last_seen_at: iso_or_nil(chat_member.user && chat_member.user.last_seen_at)
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
      sender_device_id: message.sender_device_id,
      sender_username: sender_username_for(message),
      inserted_at: DateTime.to_iso8601(message.inserted_at),
      pinned_at: iso_or_nil(message.pinned_at),
      header: encode_binary(message.header),
      ciphertext: Base.encode64(message.ciphertext),
      reply_to_message_id: message.reply_to_message_id,
      edited_at: iso_or_nil(message.edited_at),
      deleted_at: iso_or_nil(message.deleted_at),
      seq: message.seq,
      view_count: message_view_count(message),
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

  defp message_view_count(%{view_count: view_count}) when is_integer(view_count), do: view_count
  defp message_view_count(%{views: views}) when is_list(views), do: length(views)
  defp message_view_count(_message), do: 0

  defp visible_participant_ids("channel", role, _entries) when role not in ["owner", "admin"], do: []
  defp visible_participant_ids(_type, _role, entries), do: Enum.map(entries, & &1.user_id)

  defp visible_participant_names("channel", role, _entries) when role not in ["owner", "admin"], do: []

  defp visible_participant_names(_type, _role, entries) do
    entries
    |> Enum.map(& &1.username)
    |> Enum.reject(&is_nil/1)
  end

  defp normalized_permissions("direct", _permissions), do: %{}

  defp normalized_permissions(type, permissions) when type in ["group", "channel"] do
    base =
      if type == "channel" do
        %{
          "who_can_send" => "admins",
          "who_can_add_members" => "admins",
          "who_can_edit_info" => "admins",
          "who_can_pin_messages" => "admins"
        }
      else
        %{
          "who_can_send" => "everyone",
          "who_can_add_members" => "admins",
          "who_can_edit_info" => "admins",
          "who_can_pin_messages" => "admins"
        }
      end

    Map.merge(base, permissions || %{})
  end

  defp can_post?("direct", _role, _permissions), do: true
  defp can_post?(_type, role, _permissions) when role in ["owner", "admin"], do: true

  defp can_post?("group", _role, permissions) do
    Map.get(permissions, "who_can_send", "everyone") == "everyone"
  end

  defp can_post?("channel", _role, _permissions), do: false
  defp can_post?(_type, _role, _permissions), do: false

  defp can_manage_members?("direct", _role, _permissions), do: false
  defp can_manage_members?(_type, role, _permissions) when role in ["owner", "admin"], do: true

  defp can_manage_members?("group", _role, permissions) do
    Map.get(permissions, "who_can_add_members", "admins") == "everyone"
  end

  defp can_manage_members?(_type, _role, _permissions), do: false

  defp can_edit_info?("direct", _role, _permissions), do: false
  defp can_edit_info?(_type, role, _permissions) when role in ["owner", "admin"], do: true

  defp can_edit_info?("group", _role, permissions) do
    Map.get(permissions, "who_can_edit_info", "admins") == "everyone"
  end

  defp can_edit_info?(_type, _role, _permissions), do: false

  defp can_delete_chat?(type, role) when type in ["group", "channel"], do: role == "owner"
  defp can_delete_chat?(_type, _role), do: false

  defp can_leave_chat?(type, role) when type in ["group", "channel"], do: role not in [nil, "owner"]
  defp can_leave_chat?(_type, _role), do: false

  defp chat_avatar_url(%{avatar_path: nil}), do: nil
  defp chat_avatar_url(%{id: chat_id}), do: "/api/v1/chats/#{chat_id}/avatar"

  defp sender_username_for(%{sender_device: %{user: %{username: username}}}), do: username
  defp sender_username_for(_), do: nil

  defp chat_member_username(%ChatMember{user: %User{username: username}}), do: username
  defp chat_member_username(%{user: %User{username: username}}), do: username
  defp chat_member_username(_), do: nil

  defp chat_member_user_id(%ChatMember{user_id: user_id}), do: user_id
  defp chat_member_user_id(%{user_id: user_id}), do: user_id
  defp chat_member_user_id(_), do: nil
end
