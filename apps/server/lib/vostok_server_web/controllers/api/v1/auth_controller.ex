defmodule VostokServerWeb.Api.V1.AuthController do
  use VostokServerWeb, :controller

  alias Ecto.Changeset
  alias VostokServer.Auth

  # ── Password-based auth endpoints ───────────────────────────────────────

  def login(conn, %{"username" => username, "password" => password}) do
    ip = conn.remote_ip |> :inet.ntoa() |> to_string()
    device_info = get_req_header(conn, "user-agent") |> List.first()

    case Auth.login(username, password, %{ip: ip, device_info: device_info}) do
      {:ok, %{access_token: access_token, refresh_token: refresh_token, user: user}} ->
        json(conn, %{
          access_token: access_token,
          refresh_token: refresh_token,
          user: serialize_user(user)
        })

      {:error, {:rate_limited, seconds}} ->
        conn
        |> put_status(:too_many_requests)
        |> json(%{error: "rate_limited", retry_after: seconds, message: "Too many login attempts. Try again in #{format_duration(seconds)}."})

      {:error, {:disabled, message}} ->
        conn |> put_status(:forbidden) |> json(%{error: "disabled", message: message})

      {:error, {:unauthorized, message}} ->
        conn |> put_status(:unauthorized) |> json(%{error: "unauthorized", message: message})
    end
  end

  def login(conn, _params) do
    render_error(conn, :unprocessable_entity, :validation, "username and password are required.")
  end

  def refresh(conn, %{"refresh_token" => refresh_token}) do
    case Auth.refresh_access_token(refresh_token) do
      {:ok, %{access_token: access_token, user: user}} ->
        json(conn, %{access_token: access_token, user: serialize_user(user)})

      {:error, :invalid_refresh_token} ->
        conn |> put_status(:unauthorized) |> json(%{error: "unauthorized", message: "Invalid or expired refresh token."})
    end
  end

  def refresh(conn, _params) do
    render_error(conn, :unprocessable_entity, :validation, "refresh_token is required.")
  end

  def logout(conn, %{"refresh_token" => refresh_token}) do
    Auth.logout(refresh_token)
    json(conn, %{ok: true})
  end

  def logout(conn, _params) do
    json(conn, %{ok: true})
  end

  def check_username(conn, %{"username" => username}) do
    {:ok, result} = Auth.check_username(username)
    json(conn, result)
  end

  def validate_invite(conn, %{"code" => code}) do
    case Auth.Invite.validate_code(code) do
      {:ok, _invite} ->
        server_info = Auth.get_server_info()
        json(conn, %{valid: true, server_name: server_info.name})

      {:error, reason} ->
        json(conn, %{valid: false, reason: reason})
    end
  end

  def access_request(conn, params) do
    ip = conn.remote_ip |> :inet.ntoa() |> to_string()
    attrs = Map.merge(params, %{"ip_address" => ip})

    case Auth.create_access_request(attrs) do
      {:ok, _} -> json(conn, %{ok: true})
      {:error, _} -> render_error(conn, :unprocessable_entity, :validation, "Invalid request.")
    end
  end

  def password_reset_request(conn, params) do
    {:ok, _} = Auth.create_password_reset_request(params)
    json(conn, %{ok: true})
  end

  def change_password(conn, %{"new_password" => new_password}) do
    user = conn.assigns.current_user

    case Auth.change_password(user, new_password) do
      {:ok, _} -> json(conn, %{ok: true})
      {:error, changeset} -> render_changeset_error(conn, changeset)
    end
  end

  def change_password(conn, _params) do
    render_error(conn, :unprocessable_entity, :validation, "new_password is required.")
  end

  # ── Device challenge-response (retained for E2E) ────────────────────────

  def challenge(conn, %{"device_id" => device_id}) do
    case Auth.issue_challenge(device_id) do
      {:ok, payload} -> json(conn, payload)
      {:error, {kind, message}} -> render_error(conn, status_for(kind), kind, message)
    end
  end

  def challenge(conn, _params) do
    render_error(conn, :unprocessable_entity, :validation, "device_id is required to request a challenge.")
  end

  def verify(conn, %{"device_id" => device_id, "challenge_id" => challenge_id, "signature" => signature}) do
    case Auth.verify_challenge(device_id, challenge_id, signature) do
      {:ok, session} -> json(conn, %{session: session})
      {:error, %Changeset{} = changeset} -> render_changeset_error(conn, changeset)
      {:error, {kind, message}} -> render_error(conn, status_for(kind), kind, message)
    end
  end

  def verify(conn, _params) do
    render_error(conn, :unprocessable_entity, :validation, "device_id, challenge_id, and signature are required.")
  end

  # ── Helpers ─────────────────────────────────────────────────────────────

  defp serialize_user(user) do
    %{
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      temp_password: user.temp_password
    }
  end

  defp format_duration(seconds) when seconds >= 60, do: "#{div(seconds, 60)} minutes"
  defp format_duration(seconds), do: "#{seconds} seconds"

  defp status_for(:not_found), do: :not_found
  defp status_for(:unauthorized), do: :unauthorized
  defp status_for(kind) when kind in [:registration_closed, :invite_required], do: :forbidden
  defp status_for(_), do: :unprocessable_entity

  defp render_error(conn, status, kind, message) do
    conn
    |> put_status(status)
    |> json(%{error: Atom.to_string(kind), message: message})
  end

  defp render_changeset_error(conn, changeset) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{
      error: "validation_failed",
      details: Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
    })
  end
end
