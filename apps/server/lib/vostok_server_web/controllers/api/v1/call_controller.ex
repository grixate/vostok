defmodule VostokServerWeb.Api.V1.CallController do
  use VostokServerWeb, :controller

  alias VostokServer.Calls

  def active_call(conn, %{"chat_id" => chat_id}) do
    case Calls.active_call_for_chat(chat_id, conn.assigns.current_user.id) do
      {:ok, call} ->
        json(conn, %{call: call})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def create_call(conn, %{"chat_id" => chat_id} = params) do
    case Calls.start_call(
           chat_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id,
           params
         ) do
      {:ok, call} ->
        conn
        |> put_status(:created)
        |> json(%{call: call})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def call_state(conn, %{"call_id" => call_id}) do
    case Calls.call_state(call_id, conn.assigns.current_user.id) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def join_call(conn, %{"call_id" => call_id} = params) do
    case Calls.join_call(
           call_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id,
           params
         ) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def signals(conn, %{"call_id" => call_id}) do
    case Calls.list_signals(call_id, conn.assigns.current_user.id) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def emit_signal(conn, %{"call_id" => call_id} = params) do
    case Calls.emit_signal(
           call_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id,
           params
         ) do
      {:ok, payload} ->
        conn
        |> put_status(:created)
        |> json(payload)

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def call_keys(conn, %{"call_id" => call_id}) do
    case Calls.list_call_keys(
           call_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id
         ) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def rotate_call_keys(conn, %{"call_id" => call_id} = params) do
    case Calls.rotate_call_keys(
           call_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id,
           params
         ) do
      {:ok, payload} ->
        conn
        |> put_status(:created)
        |> json(payload)

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def provision_webrtc_endpoint(conn, %{"call_id" => call_id}) do
    case Calls.provision_webrtc_endpoint(
           call_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id
         ) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def webrtc_endpoint_state(conn, %{"call_id" => call_id}) do
    case Calls.get_webrtc_endpoint_state(
           call_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id
         ) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def push_webrtc_media_event(conn, %{"call_id" => call_id} = params) do
    case Calls.push_webrtc_media_event(
           call_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id,
           params
         ) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def poll_webrtc_media_events(conn, %{"call_id" => call_id}) do
    case Calls.poll_webrtc_media_events(
           call_id,
           conn.assigns.current_user.id,
           conn.assigns.current_device.id
         ) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def leave_call(conn, %{"call_id" => call_id}) do
    case Calls.leave_call(call_id, conn.assigns.current_user.id, conn.assigns.current_device.id) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def end_call(conn, %{"call_id" => call_id}) do
    case Calls.end_call(call_id, conn.assigns.current_user.id) do
      {:ok, call} ->
        json(conn, %{call: call})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def turn_credentials(conn, params) do
    ttl_seconds = normalize_ttl_seconds(Map.get(params, "ttl_seconds"))
    expires_at_unix = System.system_time(:second) + ttl_seconds
    username = "#{expires_at_unix}:#{conn.assigns.current_device.id}"
    secret = Application.get_env(:vostok_server, :turn_shared_secret, "vostok-dev-turn-secret")

    password =
      :crypto.mac(:hmac, :sha, secret, username)
      |> Base.encode64()

    uris =
      Application.get_env(:vostok_server, :public_turn_uris, [
        "turn:localhost:3478?transport=udp",
        "turn:localhost:3478?transport=tcp"
      ])

    json(conn, %{
      turn: %{
        username: username,
        password: password,
        ttl_seconds: ttl_seconds,
        expires_at: DateTime.to_iso8601(DateTime.from_unix!(expires_at_unix)),
        uris: uris
      }
    })
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

  defp normalize_ttl_seconds(value) when is_integer(value) and value >= 60 and value <= 86_400,
    do: value

  defp normalize_ttl_seconds(_), do: 3_600
end
