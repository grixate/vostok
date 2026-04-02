defmodule VostokServerWeb.Api.V1.CallRoomController do
  use VostokServerWeb, :controller

  alias VostokServer.Calls

  def create(conn, params) do
    case Calls.create_call_room(conn.assigns.current_user.id, params) do
      {:ok, payload} ->
        conn
        |> put_status(:created)
        |> json(payload)

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def show(conn, %{"room_id" => room_id}) do
    case Calls.get_call_room(room_id, conn.assigns.current_user.id) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def active_call(conn, %{"room_id" => room_id}) do
    case Calls.active_call_for_room(room_id, conn.assigns.current_user.id) do
      {:ok, call} ->
        json(conn, %{call: call})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def create_call(conn, %{"room_id" => room_id} = params) do
    case Calls.start_call_room(
           room_id,
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

  def recipient_devices(conn, %{"room_id" => room_id}) do
    case Calls.list_call_room_recipient_devices(room_id, conn.assigns.current_user.id) do
      {:ok, recipient_devices} ->
        json(conn, %{recipient_devices: recipient_devices})

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
