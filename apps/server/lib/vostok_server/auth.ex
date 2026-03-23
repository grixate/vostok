defmodule VostokServer.Auth do
  @moduledoc """
  Authentication context — username/password login, registration, JWT tokens,
  and refresh token management. Device challenge-response auth is retained
  for E2E encryption device registration.
  """

  import Ecto.Query

  alias VostokServer.Auth.{ChallengeStore, Invite, Password, RateLimiter, Token}
  alias VostokServer.Identity.{Device, DeviceSession, RefreshToken, User}
  alias VostokServer.Repo

  @session_ttl_days 30

  # ── Username/Password Authentication ────────────────────────────────────

  def login(username, password, opts \\ %{}) do
    ip = Map.get(opts, :ip, "unknown")
    device_info = Map.get(opts, :device_info)

    with :ok <- RateLimiter.check_rate(username, ip),
         %User{status: "active"} = user <- get_user_by_username(username),
         true <- Password.verify(password, user.password_hash) do
      RateLimiter.reset(username, ip)
      issue_auth_tokens(user, device_info, ip)
    else
      {:error, seconds} when is_integer(seconds) ->
        {:error, {:rate_limited, seconds}}

      %User{status: "disabled"} ->
        {:error, {:disabled, "Your account has been disabled. Contact your server administrator."}}

      nil ->
        # Constant-time comparison to prevent timing-based username enumeration
        Argon2.no_user_verify()
        RateLimiter.record_failure(username, ip)
        {:error, {:unauthorized, "Invalid username or password."}}

      false ->
        RateLimiter.record_failure(username, ip)
        {:error, {:unauthorized, "Invalid username or password."}}
    end
  end

  def register(params) do
    auth_mode = auth_mode()
    invite_code = Map.get(params, "invite_code") || Map.get(params, :invite_code)

    with :ok <- check_registration_allowed(auth_mode, invite_code),
         {:ok, user} <- create_user_with_password(params, auth_mode),
         :ok <- maybe_consume_invite(invite_code, user.id),
         {:ok, tokens} <- issue_auth_tokens(user) do
      {:ok, Map.merge(tokens, %{user: user})}
    end
  end

  def register_bootstrap(params) do
    if Repo.aggregate(User, :count) > 0 do
      {:error, {:forbidden, "Server already has users. Bootstrap is disabled."}}
    else
      attrs =
        params
        |> Map.put("role", "admin")
        |> Map.put(:role, "admin")

      with {:ok, user} <- do_create_user(attrs),
           {:ok, tokens} <- issue_auth_tokens(user) do
        {:ok, Map.merge(tokens, %{user: user})}
      end
    end
  end

  def refresh_access_token(refresh_token_raw) when is_binary(refresh_token_raw) do
    hash = Token.hash_refresh_token(refresh_token_raw)
    now = DateTime.utc_now()

    query =
      from(rt in RefreshToken,
        join: u in assoc(rt, :user),
        where:
          rt.token_hash == ^hash and
            rt.expires_at > ^now and
            is_nil(rt.revoked_at) and
            u.status == "active",
        preload: [user: u],
        limit: 1
      )

    case Repo.one(query) do
      %RefreshToken{user: user} ->
        case Token.generate_access_token(user) do
          {:ok, access_token} ->
            {:ok, %{access_token: access_token, user: user}}

          error ->
            error
        end

      nil ->
        {:error, :invalid_refresh_token}
    end
  end

  def refresh_access_token(_), do: {:error, :invalid_refresh_token}

  def logout(refresh_token_raw) when is_binary(refresh_token_raw) do
    hash = Token.hash_refresh_token(refresh_token_raw)

    case Repo.one(from(rt in RefreshToken, where: rt.token_hash == ^hash, limit: 1)) do
      %RefreshToken{} = rt ->
        rt |> Ecto.Changeset.change(%{revoked_at: DateTime.utc_now()}) |> Repo.update()
        :ok

      nil ->
        :ok
    end
  end

  def logout(_), do: :ok

  def check_username(username) when is_binary(username) do
    available = !Repo.exists?(from(u in User, where: u.username == ^username))
    {:ok, %{available: available}}
  end

  def change_password(user, new_password) do
    user
    |> User.password_changeset(%{password: new_password, temp_password: false})
    |> Repo.update()
  end

  def get_server_info do
    user_count = Repo.aggregate(User, :count)

    %{
      name: Application.get_env(:vostok_server, :server_name, "Vostok"),
      version: "0.1.0",
      auth_mode: auth_mode(),
      access_requests_enabled: false,
      bootstrap: user_count == 0
    }
  end

  # ── Access Requests ─────────────────────────────────────────────────────

  alias VostokServer.Identity.AccessRequest

  def create_access_request(params) do
    %AccessRequest{}
    |> AccessRequest.changeset(params)
    |> Repo.insert()
  end

  def list_access_requests do
    from(ar in AccessRequest, where: ar.status == "pending", order_by: [desc: ar.inserted_at])
    |> Repo.all()
  end

  def approve_access_request(request_id, admin_user) do
    case Repo.get(AccessRequest, request_id) do
      %AccessRequest{status: "pending"} = request ->
        with {:ok, %{invite: invite, code: code}} <- Invite.create_invite(admin_user) do
          request
          |> AccessRequest.changeset(%{status: "approved", reviewed_by: admin_user.id, invite_id: invite.id})
          |> Repo.update()

          {:ok, %{code: code, invite: invite}}
        end

      _ ->
        {:error, "Access request not found or already reviewed."}
    end
  end

  def deny_access_request(request_id, admin_user) do
    case Repo.get(AccessRequest, request_id) do
      %AccessRequest{status: "pending"} = request ->
        request
        |> AccessRequest.changeset(%{status: "denied", reviewed_by: admin_user.id})
        |> Repo.update()

      _ ->
        {:error, "Access request not found or already reviewed."}
    end
  end

  # ── Password Reset Requests ────────────────────────────────────────────

  alias VostokServer.Identity.PasswordResetRequest

  def create_password_reset_request(params) do
    username = Map.get(params, "username") || Map.get(params, :username)

    # Always return success to prevent username enumeration
    case get_user_by_username(username) do
      %User{} = user ->
        %PasswordResetRequest{}
        |> PasswordResetRequest.changeset(%{
          user_id: user.id,
          message: Map.get(params, "message") || Map.get(params, :message)
        })
        |> Repo.insert()

      nil ->
        :ok
    end

    {:ok, %{ok: true}}
  end

  def list_password_reset_requests do
    from(pr in PasswordResetRequest,
      where: pr.status == "pending",
      order_by: [desc: pr.inserted_at],
      preload: [:user]
    )
    |> Repo.all()
  end

  def approve_password_reset(request_id, admin_user) do
    case Repo.get(PasswordResetRequest, request_id) |> Repo.preload(:user) do
      %PasswordResetRequest{status: "pending", user: user} = request ->
        temp_password = Password.generate_temp_password()

        user
        |> User.password_changeset(%{password: temp_password, temp_password: true})
        |> Repo.update!()

        request
        |> PasswordResetRequest.changeset(%{status: "approved", reviewed_by: admin_user.id})
        |> Repo.update()

        {:ok, %{temp_password: temp_password}}

      _ ->
        {:error, "Password reset request not found or already reviewed."}
    end
  end

  def deny_password_reset(request_id, admin_user) do
    case Repo.get(PasswordResetRequest, request_id) do
      %PasswordResetRequest{status: "pending"} = request ->
        request
        |> PasswordResetRequest.changeset(%{status: "denied", reviewed_by: admin_user.id})
        |> Repo.update()

      _ ->
        {:error, "Password reset request not found or already reviewed."}
    end
  end

  # ── Device Challenge-Response (retained for E2E encryption) ─────────────

  def issue_challenge(device_id) when is_binary(device_id) do
    case Repo.get(Device, device_id) do
      %Device{revoked_at: nil} = device ->
        with {:ok, challenge} <- ChallengeStore.issue(device.id) do
          {:ok,
           %{
             device_id: device.id,
             challenge_id: challenge.challenge_id,
             challenge: Base.encode64(challenge.challenge),
             algorithm: "Ed25519",
             expires_at: DateTime.to_iso8601(challenge.expires_at)
           }}
        end

      %Device{} ->
        {:error, {:unauthorized, "This device has been revoked."}}

      nil ->
        {:error, {:not_found, "Device not found."}}
    end
  end

  def verify_challenge(device_id, challenge_id, signature_base64)
      when is_binary(device_id) and is_binary(challenge_id) and is_binary(signature_base64) do
    with %Device{revoked_at: nil} = device <- Repo.get(Device, device_id),
         {:ok, signature} <- decode_signature(signature_base64),
         {:ok, %{challenge: challenge}} <- ChallengeStore.take_for_device(challenge_id, device.id),
         true <- verify_signature(device.identity_public_key, challenge, signature),
         {:ok, session} <- issue_session_for_device(device) do
      {:ok, session}
    else
      nil -> {:error, {:not_found, "Device not found."}}
      {:error, :device_mismatch} -> {:error, {:unauthorized, "Challenge does not belong to this device."}}
      {:error, :not_found} -> {:error, {:unauthorized, "Challenge is missing or expired."}}
      {:error, {:validation, _field, _message} = reason} -> {:error, reason}
      false -> {:error, {:unauthorized, "Challenge signature verification failed."}}
      {:error, reason} -> {:error, reason}
    end
  end

  def verify_challenge(_, _, _),
    do: {:error, {:validation, "signature", "Device id, challenge id, and signature are required strings."}}

  def issue_session_for_device(%Device{} = device) do
    now = DateTime.utc_now()
    raw_token = generate_session_token()
    expires_at = DateTime.add(now, @session_ttl_days, :day)

    device
    |> Ecto.build_assoc(:device_sessions)
    |> DeviceSession.changeset(%{
      token_hash: hash_session_token(raw_token),
      expires_at: expires_at,
      last_seen_at: now
    })
    |> Repo.insert()
    |> case do
      {:ok, _} -> {:ok, %{token: raw_token, expires_at: DateTime.to_iso8601(expires_at)}}
      {:error, changeset} -> {:error, changeset}
    end
  end

  def authenticate_session_token(token) when is_binary(token) do
    now = DateTime.utc_now()
    token_hash = hash_session_token(token)

    from(session in DeviceSession,
      join: device in assoc(session, :device),
      where:
        session.token_hash == ^token_hash and session.expires_at > ^now and
          is_nil(device.revoked_at),
      preload: [device: device],
      limit: 1
    )
    |> Repo.one()
    |> case do
      %DeviceSession{} = session ->
        session |> DeviceSession.changeset(%{last_seen_at: now}) |> Repo.update()
        {:ok, Repo.preload(session, device: :user)}

      nil ->
        :error
    end
  end

  def authenticate_session_token(_), do: :error

  # ── Private helpers ─────────────────────────────────────────────────────

  defp get_user_by_username(username) when is_binary(username) do
    Repo.one(from(u in User, where: u.username == ^username, limit: 1))
  end

  defp get_user_by_username(_), do: nil

  defp issue_auth_tokens(user, device_info \\ nil, ip \\ nil) do
    with {:ok, access_token} <- Token.generate_access_token(user),
         refresh_token_raw = Token.generate_refresh_token(),
         {:ok, _} <- store_refresh_token(user, refresh_token_raw, device_info, ip) do
      {:ok,
       %{
         access_token: access_token,
         refresh_token: refresh_token_raw,
         user: user
       }}
    end
  end

  defp store_refresh_token(user, raw_token, device_info, ip) do
    user
    |> Ecto.build_assoc(:refresh_tokens)
    |> RefreshToken.changeset(%{
      token_hash: Token.hash_refresh_token(raw_token),
      device_info: device_info,
      ip_address: ip,
      expires_at: Token.refresh_token_expires_at()
    })
    |> Repo.insert()
  end

  defp create_user_with_password(params, auth_mode) do
    attrs = %{
      "username" => Map.get(params, "username") || Map.get(params, :username),
      "display_name" => Map.get(params, "display_name") || Map.get(params, :display_name),
      "password" => Map.get(params, "password") || Map.get(params, :password),
      "dev" => auth_mode == "dev"
    }

    do_create_user(attrs)
  end

  defp do_create_user(attrs) do
    case %User{} |> User.registration_changeset(attrs) |> Repo.insert() do
      {:ok, user} ->
        # Auto-create a placeholder device so messaging works without E2E setup
        ensure_default_device(user)
        {:ok, user}

      error ->
        error
    end
  end

  defp ensure_default_device(user) do
    existing = Repo.one(from(d in Device, where: d.user_id == ^user.id, limit: 1))

    if existing do
      existing
    else
      user
      |> Ecto.build_assoc(:devices)
      |> Device.changeset(%{
        device_name: "Web",
        identity_public_key: :crypto.strong_rand_bytes(32)
      })
      |> Repo.insert!()
    end
  end

  defp check_registration_allowed("dev", _invite_code), do: :ok

  defp check_registration_allowed("closed", _invite_code) do
    {:error, {:registration_closed, "Registration is closed on this server."}}
  end

  defp check_registration_allowed(_mode, nil) do
    {:error, {:invite_required, "An invite code is required to register."}}
  end

  defp check_registration_allowed(_mode, code) when is_binary(code) do
    case Invite.validate_code(code) do
      {:ok, _invite} -> :ok
      {:error, reason} -> {:error, {:invalid_invite, reason}}
    end
  end

  defp maybe_consume_invite(nil, _user_id), do: :ok
  defp maybe_consume_invite("", _user_id), do: :ok

  defp maybe_consume_invite(code, user_id) do
    case Invite.consume_invite(code, user_id) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, {:invalid_invite, reason}}
    end
  end

  defp auth_mode do
    Application.get_env(:vostok_server, :auth_mode) ||
      Application.get_env(:vostok_server, :registration_mode, "invite_only")
  end

  defp decode_signature(signature_base64) do
    case Base.decode64(signature_base64) do
      {:ok, signature} -> {:ok, signature}
      :error -> {:error, {:validation, "signature", "Signature must be valid base64."}}
    end
  end

  defp verify_signature(public_key, challenge, signature) do
    :crypto.verify(:eddsa, :none, challenge, signature, [public_key, :ed25519])
  rescue
    _ -> false
  end

  defp generate_session_token do
    :crypto.strong_rand_bytes(32) |> Base.url_encode64(padding: false)
  end

  defp hash_session_token(token) do
    :crypto.hash(:sha256, token)
  end
end
