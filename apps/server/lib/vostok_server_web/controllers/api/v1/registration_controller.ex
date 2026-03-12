defmodule VostokServerWeb.Api.V1.RegistrationController do
  use VostokServerWeb, :controller

  alias Ecto.Changeset
  alias VostokServer.Auth
  alias VostokServer.Identity
  alias VostokServer.Messaging

  def create(conn, params) do
    with {:ok, registration} <- Identity.register_device(params),
         {:ok, session} <- Auth.issue_session_for_device(registration.device),
         _ <- Messaging.ensure_self_chat(registration.user) do
      conn
      |> put_status(:created)
      |> json(%{
        user: %{
          id: registration.user.id,
          username: registration.user.username
        },
        device: %{
          id: registration.device.id,
          device_name: registration.device.device_name
        },
        session: session,
        prekey_count: length(registration.one_time_prekeys)
      })
    else
      {:error, %Changeset{} = changeset} ->
        render_changeset_error(conn, changeset)

      {:error, {kind, _message} = reason} when kind in [:registration_closed, :invite_required] ->
        render_error(conn, :forbidden, reason)

      {:error, {kind, _message} = reason}
      when kind in [:validation, :invalid_invite, :unauthorized, :not_found] ->
        render_error(conn, :unprocessable_entity, reason)

      {:error, other} ->
        render_error(conn, :unprocessable_entity, {:validation, inspect(other)})
    end
  end

  defp render_changeset_error(conn, changeset) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{
      error: "validation_failed",
      details: Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
    })
  end

  defp render_error(conn, status, {kind, message}) do
    conn
    |> put_status(status)
    |> json(%{error: Atom.to_string(kind), message: message})
  end
end
