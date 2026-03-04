defmodule VostokServer.Auth do
  @moduledoc """
  Stage 2 device challenge and session-token authentication.
  """

  import Ecto.Query

  alias VostokServer.Auth.ChallengeStore
  alias VostokServer.Identity.{Device, DeviceSession}
  alias VostokServer.Repo

  @session_ttl_days 30

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
      nil ->
        {:error, {:not_found, "Device not found."}}

      {:error, :device_mismatch} ->
        {:error, {:unauthorized, "Challenge does not belong to this device."}}

      {:error, :not_found} ->
        {:error, {:unauthorized, "Challenge is missing or expired."}}

      {:error, {:validation, _field, _message} = reason} ->
        {:error, reason}

      false ->
        {:error, {:unauthorized, "Challenge signature verification failed."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def verify_challenge(_, _, _),
    do:
      {:error,
       {:validation, "signature", "Device id, challenge id, and signature are required strings."}}

  def issue_session_for_device(%Device{} = device) do
    now = DateTime.utc_now()
    raw_token = generate_token()
    expires_at = DateTime.add(now, @session_ttl_days, :day)

    device
    |> Ecto.build_assoc(:device_sessions)
    |> DeviceSession.changeset(%{
      token_hash: hash_token(raw_token),
      expires_at: expires_at,
      last_seen_at: now
    })
    |> Repo.insert()
    |> case do
      {:ok, _device_session} ->
        {:ok,
         %{
           token: raw_token,
           expires_at: DateTime.to_iso8601(expires_at)
         }}

      {:error, changeset} ->
        {:error, changeset}
    end
  end

  def authenticate_session_token(token) when is_binary(token) do
    now = DateTime.utc_now()
    token_hash = hash_token(token)

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
        session
        |> DeviceSession.changeset(%{last_seen_at: now})
        |> Repo.update()

        {:ok, Repo.preload(session, device: :user)}

      nil ->
        :error
    end
  end

  def authenticate_session_token(_), do: :error

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

  defp generate_token do
    32
    |> :crypto.strong_rand_bytes()
    |> Base.url_encode64(padding: false)
  end

  defp hash_token(token) do
    :crypto.hash(:sha256, token)
  end
end
