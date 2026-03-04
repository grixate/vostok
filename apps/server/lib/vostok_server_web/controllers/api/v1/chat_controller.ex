defmodule VostokServerWeb.Api.V1.ChatController do
  use VostokServerWeb, :controller

  alias VostokServer.Messaging

  def me(conn, _params) do
    current_user = conn.assigns.current_user
    current_device = conn.assigns.current_device
    current_session = conn.assigns.current_session

    json(conn, %{
      user: %{
        id: current_user.id,
        username: current_user.username
      },
      device: %{
        id: current_device.id,
        device_name: current_device.device_name
      },
      session: %{
        expires_at: DateTime.to_iso8601(current_session.expires_at)
      }
    })
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
