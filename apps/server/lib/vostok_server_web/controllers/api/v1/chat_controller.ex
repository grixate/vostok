defmodule VostokServerWeb.Api.V1.ChatController do
  use VostokServerWeb, :controller

  alias VostokServer.Identity
  alias VostokServer.Messaging

  def me(conn, _params) do
    current_user = conn.assigns.current_user
    current_device = conn.assigns.current_device
    current_session = conn.assigns.current_session
    prekeys = prekey_inventory(current_device.id)

    json(conn, %{
      user: %{
        id: current_user.id,
        username: current_user.username
      },
      device: %{
        id: current_device.id,
        device_name: current_device.device_name,
        prekeys: prekeys
      },
      session: %{
        expires_at: DateTime.to_iso8601(current_session.expires_at)
      }
    })
  end

  defp prekey_inventory(device_id) when is_binary(device_id) do
    case Identity.prekey_inventory(device_id) do
      {:ok, inventory} -> inventory
      _ -> nil
    end
  end

  def index(conn, _params) do
    chats = Messaging.list_chats_for_user(conn.assigns.current_user.id)
    json(conn, %{chats: chats})
  end

  def create_direct(conn, %{"username" => username}) do
    case Messaging.ensure_direct_chat(conn.assigns.current_user.id, username) do
      {:ok, chat} ->
        conn
        |> put_status(:created)
        |> json(%{chat: chat})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def create_direct(conn, _params) do
    render_error(conn, :validation, "username is required.")
  end

  def create_group(conn, params) do
    case Messaging.create_group_chat(conn.assigns.current_user.id, params) do
      {:ok, chat} ->
        conn
        |> put_status(:created)
        |> json(%{chat: chat})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def update_group(conn, %{"chat_id" => chat_id} = params) do
    case Messaging.rename_group_chat(chat_id, conn.assigns.current_user.id, params) do
      {:ok, chat} ->
        json(conn, %{chat: chat})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def group_members(conn, %{"chat_id" => chat_id}) do
    case Messaging.list_group_members(chat_id, conn.assigns.current_user.id) do
      {:ok, members} ->
        json(conn, %{members: members})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def update_group_member(conn, %{"chat_id" => chat_id, "user_id" => user_id} = params) do
    case Messaging.update_group_member_role(
           chat_id,
           conn.assigns.current_user.id,
           user_id,
           params
         ) do
      {:ok, member} ->
        json(conn, %{member: member})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def remove_group_member(conn, %{"chat_id" => chat_id, "user_id" => user_id}) do
    case Messaging.remove_group_member(chat_id, conn.assigns.current_user.id, user_id) do
      {:ok, member} ->
        json(conn, %{member: member})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def list_group_sender_keys(conn, %{"chat_id" => chat_id}) do
    case Messaging.list_group_sender_keys(
           chat_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id
         ) do
      {:ok, sender_keys} ->
        json(conn, %{sender_keys: sender_keys})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def distribute_group_sender_keys(conn, %{"chat_id" => chat_id} = params) do
    case Messaging.distribute_group_sender_keys(
           chat_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id,
           params
         ) do
      {:ok, sender_keys} ->
        conn
        |> put_status(:created)
        |> json(%{sender_keys: sender_keys})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def session_bootstrap(conn, %{"chat_id" => chat_id} = params) do
    case Messaging.bootstrap_chat_sessions(
           chat_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id,
           params
         ) do
      {:ok, sessions} ->
        json(conn, %{sessions: sessions})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def session_rekey(conn, %{"chat_id" => chat_id} = params) do
    case Messaging.rekey_chat_sessions(
           chat_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id,
           params
         ) do
      {:ok, sessions} ->
        json(conn, %{sessions: sessions})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def safety_numbers(conn, %{"chat_id" => chat_id}) do
    case Messaging.list_safety_numbers(
           chat_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id
         ) do
      {:ok, safety_numbers} ->
        json(conn, %{safety_numbers: safety_numbers})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def verify_safety_number(conn, %{"chat_id" => chat_id, "peer_device_id" => peer_device_id}) do
    case Messaging.verify_safety_number(
           chat_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id,
           peer_device_id
         ) do
      {:ok, safety_number} ->
        json(conn, %{safety_number: safety_number})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def recipient_devices(conn, %{"chat_id" => chat_id}) do
    case Messaging.list_recipient_devices(chat_id, conn.assigns.current_user.id) do
      {:ok, recipient_devices} ->
        json(conn, %{recipient_devices: recipient_devices})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def messages(conn, %{"chat_id" => chat_id}) do
    case Messaging.list_messages_for_chat(
           chat_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id
         ) do
      {:ok, messages} ->
        json(conn, %{messages: messages})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def mark_read(conn, %{"chat_id" => chat_id} = params) do
    case Messaging.mark_chat_read(
           chat_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id,
           params
         ) do
      {:ok, read_state} ->
        json(conn, %{read_state: read_state})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def create_message(conn, %{"chat_id" => chat_id} = params) do
    case Messaging.create_message(
           chat_id,
           conn.assigns.current_device.id,
           conn.assigns.current_user.id,
           params,
           conn.assigns.current_device.id
         ) do
      {:ok, message} ->
        conn
        |> put_status(:created)
        |> json(%{message: message})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def update_message(conn, %{"chat_id" => chat_id, "message_id" => message_id} = params) do
    case Messaging.edit_message(
           chat_id,
           message_id,
           conn.assigns.current_device.id,
           conn.assigns.current_user.id,
           params,
           conn.assigns.current_device.id
         ) do
      {:ok, message} ->
        json(conn, %{message: message})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def delete_message(conn, %{"chat_id" => chat_id, "message_id" => message_id}) do
    case Messaging.delete_message(
           chat_id,
           message_id,
           conn.assigns.current_device.id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id
         ) do
      {:ok, message} ->
        json(conn, %{message: message})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def toggle_pin(conn, %{"chat_id" => chat_id, "message_id" => message_id}) do
    case Messaging.toggle_message_pin(
           chat_id,
           message_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id
         ) do
      {:ok, message} ->
        json(conn, %{message: message})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def toggle_reaction(conn, %{"chat_id" => chat_id, "message_id" => message_id} = params) do
    case Messaging.toggle_message_reaction(
           chat_id,
           message_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id,
           params
         ) do
      {:ok, message} ->
        json(conn, %{message: message})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  defp render_error(conn, :not_found, message) do
    conn
    |> put_status(:not_found)
    |> json(%{error: "not_found", message: message})
  end

  defp render_error(conn, _kind, message) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: "validation", message: message})
  end
end
