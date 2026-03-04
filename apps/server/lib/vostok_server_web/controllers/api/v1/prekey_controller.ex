defmodule VostokServerWeb.Api.V1.PrekeyController do
  use VostokServerWeb, :controller

  alias Ecto.Changeset
  alias VostokServer.Identity

  def publish(conn, params) do
    case Identity.publish_device_prekeys(conn.assigns.current_device.id, params) do
      {:ok, result} ->
        json(conn, %{
          device_id: result.device_id,
          has_signed_prekey: result.has_signed_prekey,
          one_time_prekey_count: result.one_time_prekey_count
        })

      {:error, %Changeset{} = changeset} ->
        render_changeset_error(conn, changeset)

      {:error, {kind, message}} ->
        render_error(conn, status_for(kind), kind, message)

      {:error, other} ->
        render_error(conn, :unprocessable_entity, :validation, inspect(other))
    end
  end

  def show(conn, %{"username" => username}) do
    case Identity.fetch_user_prekey_bundles(username) do
      {:ok, prekey_bundles} ->
        json(conn, %{user: %{username: username}, devices: prekey_bundles})

      {:error, {kind, message}} ->
        render_error(conn, status_for(kind), kind, message)
    end
  end

  defp status_for(:not_found), do: :not_found
  defp status_for(:unauthorized), do: :unprocessable_entity
  defp status_for(:validation), do: :unprocessable_entity
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
