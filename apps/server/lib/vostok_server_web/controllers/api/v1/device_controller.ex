defmodule VostokServerWeb.Api.V1.DeviceController do
  use VostokServerWeb, :controller

  alias Ecto.Changeset
  alias VostokServer.Auth
  alias VostokServer.Identity

  def index(conn, _params) do
    case Identity.list_user_devices(conn.assigns.current_user.id, conn.assigns.current_device.id) do
      {:ok, devices} ->
        json(conn, %{devices: devices})

      {:error, {kind, message}} ->
        render_error(conn, status_for(kind), kind, message)
    end
  end

  def link(conn, params) do
    with {:ok, linked} <- Identity.link_device(conn.assigns.current_user.id, params),
         {:ok, session} <- Auth.issue_session_for_device(linked.device) do
      conn
      |> put_status(:created)
      |> json(%{
        user: %{
          id: linked.user.id,
          username: linked.user.username
        },
        device: %{
          id: linked.device.id,
          device_name: linked.device.device_name
        },
        session: session,
        prekey_count: length(linked.one_time_prekeys)
      })
    else
      {:error, %Changeset{} = changeset} ->
        render_changeset_error(conn, changeset)

      {:error, {kind, message}} ->
        render_error(conn, status_for(kind), kind, message)

      {:error, other} ->
        render_error(conn, :unprocessable_entity, :validation, inspect(other))
    end
  end

  def revoke(conn, %{"device_id" => device_id}) do
    case Identity.revoke_device(
           conn.assigns.current_user.id,
           device_id,
           conn.assigns.current_device.id
         ) do
      {:ok, device} ->
        json(conn, %{device: device})

      {:error, {kind, message}} ->
        render_error(conn, status_for(kind), kind, message)
    end
  end

  defp status_for(:not_found), do: :not_found
  defp status_for(:validation), do: :unprocessable_entity
  defp status_for(:unauthorized), do: :unauthorized
  defp status_for(_), do: :unprocessable_entity

  defp render_changeset_error(conn, changeset) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{
      error: "validation_failed",
      details: Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
    })
  end

  defp render_error(conn, status, kind, message) do
    conn
    |> put_status(status)
    |> json(%{error: Atom.to_string(kind), message: message})
  end
end
