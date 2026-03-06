defmodule VostokServerWeb.Api.V1.InviteController do
  use VostokServerWeb, :controller

  alias VostokServer.Identity

  # POST /api/v1/admin/invites — admin only
  def create(conn, params) do
    if conn.assigns.current_user.is_admin do
      case Identity.create_invite(conn.assigns.current_user, params) do
        {:ok, invite} ->
          conn
          |> put_status(:created)
          |> json(%{invite: invite})

        {:error, {kind, message}} ->
          render_error(conn, :unprocessable_entity, {kind, message})
      end
    else
      render_error(conn, :forbidden, {:unauthorized, "Only admins can create invites."})
    end
  end

  # GET /api/v1/admin/invites — admin only
  def index(conn, _params) do
    if conn.assigns.current_user.is_admin do
      json(conn, %{invites: Identity.list_invites()})
    else
      render_error(conn, :forbidden, {:unauthorized, "Only admins can list invites."})
    end
  end

  # POST /api/v1/admin/invites/:invite_id/revoke — admin only
  def revoke(conn, %{"invite_id" => invite_id}) do
    if conn.assigns.current_user.is_admin do
      case Identity.revoke_invite(invite_id) do
        {:ok, invite} ->
          json(conn, %{invite: invite})

        {:error, {:not_found, message}} ->
          render_error(conn, :not_found, {:not_found, message})

        {:error, {kind, message}} ->
          render_error(conn, :unprocessable_entity, {kind, message})
      end
    else
      render_error(conn, :forbidden, {:unauthorized, "Only admins can revoke invites."})
    end
  end

  # GET /api/v1/invites/:token/validate — public, unauthenticated
  def validate(conn, %{"token" => token}) do
    server_name = Application.get_env(:vostok_server, :server_name, "Vostok")

    case Identity.validate_invite_token(token) do
      {:ok, _invite} ->
        json(conn, %{valid: true, server_name: server_name})

      {:error, {:invite_expired, _}} ->
        json(conn, %{valid: false, reason: "expired"})

      {:error, {:invite_used, _}} ->
        json(conn, %{valid: false, reason: "used"})

      {:error, {:invite_revoked, _}} ->
        json(conn, %{valid: false, reason: "revoked"})

      {:error, _} ->
        json(conn, %{valid: false, reason: "not_found"})
    end
  end

  defp render_error(conn, status, {kind, message}) do
    conn
    |> put_status(status)
    |> json(%{error: Atom.to_string(kind), message: message})
  end
end
