defmodule VostokServer.Messaging.Guards do
  @moduledoc false

  import Ecto.Query

  alias VostokServer.Messaging.{Chat, ChatMember, Message}
  alias VostokServer.Repo

  def ensure_message_chat(%Message{chat_id: chat_id}, chat_id), do: :ok

  def ensure_message_chat(%Message{}, _chat_id),
    do: {:error, {:not_found, "Message not found in this chat."}}

  def ensure_message_owner(%Message{sender_device_id: sender_device_id}, sender_device_id),
    do: :ok

  def ensure_message_owner(%Message{}, _sender_device_id),
    do: {:error, {:validation, "Only the sending device can modify this message."}}

  def ensure_message_edit_permission(_chat, _membership, %Message{} = message, sender_device_id) do
    ensure_message_owner(message, sender_device_id)
  end

  def ensure_message_delete_permission(
        %Chat{type: type},
        %ChatMember{role: role},
        %Message{},
        _sender_device_id
      )
      when type in ["group", "channel"] and role in ["owner", "admin"],
      do: :ok

  def ensure_message_delete_permission(_chat, _membership, %Message{} = message, sender_device_id) do
    ensure_message_owner(message, sender_device_id)
  end

  def ensure_message_pin_permission(%Chat{type: type} = chat, %ChatMember{} = membership)
      when type in ["group", "channel"] do
    if can_pin_messages?(chat, membership) do
      :ok
    else
      {:error, {:validation, "Only permitted members can pin messages in this chat."}}
    end
  end

  def ensure_message_pin_permission(%Chat{}, %ChatMember{}), do: :ok

  def ensure_group_admin(%ChatMember{role: role}) when role in ["owner", "admin"], do: :ok

  def ensure_group_admin(%ChatMember{}),
    do: {:error, {:validation, "Only group admins can update this chat."}}

  def ensure_chat_owner(%ChatMember{role: "owner"}), do: :ok
  def ensure_chat_owner(%ChatMember{}), do: {:error, {:validation, "Only the chat owner can perform this action."}}

  def ensure_group_chat(%Chat{type: "group"}), do: :ok

  def ensure_group_chat(%Chat{}),
    do: {:error, {:validation, "Only group chats support this action."}}

  def ensure_admin_continuity(_chat_id, %ChatMember{role: "member"}, _next_role), do: :ok
  def ensure_admin_continuity(_chat_id, %ChatMember{role: "owner"}, "owner"), do: :ok
  def ensure_admin_continuity(_chat_id, %ChatMember{role: "admin"}, "admin"), do: :ok

  def ensure_admin_continuity(chat_id, %ChatMember{role: role, user_id: user_id}, _next_role)
      when role in ["owner", "admin"] do
    remaining_admin_count =
      from(chat_member in ChatMember,
        where:
          chat_member.chat_id == ^chat_id and chat_member.role in ["owner", "admin"] and
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

  def ensure_not_deleted(%Message{deleted_at: nil}), do: :ok
  def ensure_not_deleted(%Message{}), do: {:error, {:validation, "Message is already deleted."}}

  def ensure_pinnable(%Message{message_kind: "system"}),
    do: {:error, {:validation, "System messages cannot be pinned."}}

  def ensure_pinnable(%Message{}), do: :ok

  def validate_reply_target(_chat_id, nil), do: {:ok, nil}

  def validate_reply_target(chat_id, reply_to_message_id) when is_binary(reply_to_message_id) do
    case Repo.get(Message, reply_to_message_id) do
      %Message{chat_id: ^chat_id} = message -> {:ok, message}
      %Message{} -> {:error, {:validation, "Reply target must belong to this chat."}}
      nil -> {:error, {:not_found, "Reply target not found."}}
    end
  end

  def fetch_group_role(attrs, fetch_string_fun)
      when is_map(attrs) and is_function(fetch_string_fun, 3) do
    with {:ok, role} <- fetch_string_fun.(attrs, "role", "group role"),
         :ok <- validate_group_role(role) do
      {:ok, role}
    end
  end

  def format_changeset_error(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
    |> Enum.map(fn {field, [message | _]} -> "#{field} #{message}" end)
    |> List.first()
    |> Kernel.||("The record could not be saved.")
  end

  defp validate_group_role("admin"), do: :ok
  defp validate_group_role("member"), do: :ok

  defp validate_group_role(_role),
    do: {:error, {:validation, "group role must be admin or member."}}

  defp can_pin_messages?(%Chat{permissions_json: permissions}, %ChatMember{role: role})
       when role in ["owner", "admin"] do
    case Map.get(permissions || %{}, "who_can_pin_messages", "admins") do
      "everyone" -> true
      "admins" -> true
      _ -> true
    end
  end

  defp can_pin_messages?(%Chat{permissions_json: permissions}, %ChatMember{}) do
    Map.get(permissions || %{}, "who_can_pin_messages", "admins") == "everyone"
  end
end
