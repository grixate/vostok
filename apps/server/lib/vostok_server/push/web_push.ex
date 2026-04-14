defmodule VostokServer.Push.WebPush do
  @moduledoc """
  Web Push Protocol implementation using VAPID authentication.

  Implements RFC 8291 (Message Encryption for Web Push) and
  RFC 8292 (VAPID) using OTP's built-in :crypto and :public_key modules.

  No external library needed — the protocol is:
  1. ECDH key agreement (P-256)
  2. HKDF key derivation
  3. AES-128-GCM content encryption
  4. ES256 JWT for VAPID auth
  """

  require Logger

  @jwt_lifetime 3600
  @max_payload_bytes 4078

  @doc """
  Send a push notification to a Web Push subscription.

  - `subscription` — parsed JSON map with "endpoint", "keys" (p256dh, auth)
  - `payload` — binary payload to encrypt and send
  - `vapid_public_key` — base64url-encoded VAPID public key
  - `vapid_private_key` — base64url-encoded VAPID private key
  - `vapid_subject` — mailto: or https: contact URI
  """
  def send_notification(subscription, payload, vapid_public_key, vapid_private_key, vapid_subject) do
    endpoint = subscription["endpoint"]
    keys = subscription["keys"] || %{}
    p256dh = keys["p256dh"]
    auth = keys["auth"]

    cond do
      !endpoint ->
        {:error, :missing_endpoint}

      !p256dh || !auth ->
        {:error, :missing_keys}

      byte_size(payload) > @max_payload_bytes ->
        {:error, :payload_too_large}

      true ->
        do_send(endpoint, payload, p256dh, auth, vapid_public_key, vapid_private_key, vapid_subject)
    end
  end

  defp do_send(endpoint, payload, p256dh_b64, auth_b64, vapid_pub_b64, vapid_priv_b64, vapid_subject) do
    with {:ok, client_public_key} <- base64url_decode(p256dh_b64),
         {:ok, auth_secret} <- base64url_decode(auth_b64),
         {:ok, vapid_private_raw} <- base64url_decode(vapid_priv_b64),
         {:ok, encrypted_body} <- encrypt_payload(payload, client_public_key, auth_secret),
         {:ok, jwt} <- build_vapid_jwt(endpoint, vapid_private_raw, vapid_subject),
         {:ok, vapid_key} <- normalize_vapid_public(vapid_pub_b64) do
      headers = [
        {"Authorization", "vapid t=#{jwt}, k=#{vapid_key}"},
        {"Content-Encoding", "aes128gcm"},
        {"Content-Type", "application/octet-stream"},
        {"TTL", "86400"}
      ]

      case :hackney.post(endpoint, headers, encrypted_body, [:with_body]) do
        {:ok, status, _headers, _body} when status in 200..299 ->
          :ok

        {:ok, 404, _headers, _body} ->
          {:error, :subscription_expired}

        {:ok, 410, _headers, _body} ->
          {:error, :subscription_expired}

        {:ok, 429, _headers, _body} ->
          {:error, :rate_limited}

        {:ok, status, _headers, body} ->
          Logger.warning("[WebPush] Push failed with #{status}: #{inspect(body)}")
          {:error, {:http_error, status}}

        {:error, reason} ->
          Logger.warning("[WebPush] HTTP error: #{inspect(reason)}")
          {:error, {:transport_error, reason}}
      end
    end
  end

  # ── Payload encryption (RFC 8291 + aes128gcm) ─────────────────────────

  defp encrypt_payload(plaintext, client_public_key, auth_secret) do
    # Generate ephemeral ECDH key pair
    {server_public, server_private} = :crypto.generate_key(:ecdh, :prime256v1)

    # ECDH shared secret
    shared_secret = :crypto.compute_key(:ecdh, client_public_key, server_private, :prime256v1)

    # HKDF for auth info
    prk_key = hkdf_extract(auth_secret, shared_secret)

    # Build key info and nonce info (RFC 8291 Section 3.4)
    key_info = "WebPush: info\0" <> client_public_key <> server_public
    nonce_info = "Content-Encoding: nonce\0\0"
    cek_info = "Content-Encoding: aes128gcm\0\0"

    # IKM for content encryption
    ikm = hkdf_expand(prk_key, key_info, 32)

    # Derive PRK from IKM with a salt
    salt = :crypto.strong_rand_bytes(16)
    prk = hkdf_extract(salt, ikm)

    # Derive content encryption key and nonce
    cek = hkdf_expand(prk, cek_info, 16)
    nonce = hkdf_expand(prk, nonce_info, 12)

    # Pad plaintext (RFC 8291: delimiter \x02 + zero padding)
    padded = plaintext <> <<2>>

    # Encrypt with AES-128-GCM
    {ciphertext, tag} = :crypto.crypto_one_time_aead(:aes_128_gcm, cek, nonce, padded, <<>>, true)

    # Build aes128gcm record: salt(16) + rs(4) + idlen(1) + keyid(65) + encrypted
    rs = <<4096::32>>
    id_len = byte_size(server_public)
    header = salt <> rs <> <<id_len::8>> <> server_public
    body = header <> ciphertext <> tag

    {:ok, body}
  rescue
    e ->
      Logger.warning("[WebPush] Encryption failed: #{inspect(e)}")
      {:error, :encryption_failed}
  end

  # ── VAPID JWT (RFC 8292) ───────────────────────────────────────────────

  defp build_vapid_jwt(endpoint, private_key_raw, subject) do
    audience = URI.parse(endpoint) |> then(&"#{&1.scheme}://#{&1.host}")
    now = System.system_time(:second)

    header = %{"alg" => "ES256", "typ" => "JWT"} |> Jason.encode!() |> base64url_encode()
    payload = %{
      "aud" => audience,
      "exp" => now + @jwt_lifetime,
      "sub" => subject
    } |> Jason.encode!() |> base64url_encode()

    signing_input = "#{header}.#{payload}"

    # Build EC private key for signing
    # private_key_raw is 32 bytes (the d parameter)
    # We need to derive the public key from it for the key structure
    {public_key, ^private_key_raw} = :crypto.generate_key(:ecdh, :prime256v1, private_key_raw)

    signature = :crypto.sign(:ecdsa, :sha256, signing_input, [private_key_raw, :prime256v1])

    # Convert DER signature to raw r||s format (64 bytes)
    raw_sig = der_to_raw_signature(signature)
    sig_b64 = base64url_encode(raw_sig)

    _ = public_key
    {:ok, "#{signing_input}.#{sig_b64}"}
  rescue
    e ->
      Logger.warning("[WebPush] JWT signing failed: #{inspect(e)}")
      {:error, :jwt_failed}
  end

  # ── Helpers ────────────────────────────────────────────────────────────

  defp hkdf_extract(salt, ikm) do
    :crypto.mac(:hmac, :sha256, salt, ikm)
  end

  defp hkdf_expand(prk, info, length) do
    :crypto.mac(:hmac, :sha256, prk, <<info::binary, 1::8>>)
    |> binary_part(0, length)
  end

  defp der_to_raw_signature(der_sig) do
    # Parse DER-encoded ECDSA signature to extract r and s as 32-byte big-endian integers
    <<0x30, _total_len, 0x02, r_len, r::binary-size(r_len), 0x02, s_len, rest::binary>> = der_sig
    s = binary_part(rest, 0, s_len)

    # Strip leading zero padding and pad to 32 bytes
    r_trimmed = r |> :binary.bin_to_list() |> Enum.drop_while(&(&1 == 0)) |> :binary.list_to_bin()
    s_trimmed = s |> :binary.bin_to_list() |> Enum.drop_while(&(&1 == 0)) |> :binary.list_to_bin()

    pad(r_trimmed, 32) <> pad(s_trimmed, 32)
  end

  defp pad(bin, target) when byte_size(bin) >= target, do: binary_part(bin, byte_size(bin) - target, target)
  defp pad(bin, target), do: :binary.copy(<<0>>, target - byte_size(bin)) <> bin

  defp base64url_encode(data) do
    Base.url_encode64(data, padding: false)
  end

  defp base64url_decode(data) do
    case Base.url_decode64(data, padding: false) do
      {:ok, _} = ok -> ok
      :error -> {:error, :invalid_base64}
    end
  end

  defp normalize_vapid_public(key_b64) do
    # Ensure no padding for the k= parameter
    {:ok, key_b64 |> String.replace("=", "")}
  end
end
