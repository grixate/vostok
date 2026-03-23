defmodule VostokServer.Auth.Token do
  @moduledoc """
  JWT access token generation and verification, plus refresh token utilities.
  """

  use Joken.Config

  @access_token_ttl_seconds 900
  @refresh_token_ttl_days 30

  @impl Joken.Config
  def token_config do
    default_claims(
      iss: "vostok",
      default_exp: @access_token_ttl_seconds
    )
    |> add_claim("role", nil, &(&1 in ["admin", "member"]))
  end

  def generate_access_token(user) do
    claims = %{
      "sub" => user.id,
      "role" => user.role,
      "username" => user.username
    }

    case generate_and_sign(claims, signer()) do
      {:ok, token, _claims} -> {:ok, token}
      error -> error
    end
  end

  def verify_access_token(token) when is_binary(token) do
    case verify_and_validate(token, signer()) do
      {:ok, claims} -> {:ok, claims}
      {:error, reason} -> {:error, reason}
    end
  end

  def verify_access_token(_), do: {:error, :invalid_token}

  @doc "Generates a random 32-byte URL-safe refresh token."
  def generate_refresh_token do
    :crypto.strong_rand_bytes(32)
    |> Base.url_encode64(padding: false)
  end

  @doc "SHA-256 hash for storing refresh tokens in the database."
  def hash_refresh_token(token) when is_binary(token) do
    :crypto.hash(:sha256, token)
  end

  def refresh_token_expires_at do
    DateTime.utc_now() |> DateTime.add(@refresh_token_ttl_days, :day)
  end

  defp signer do
    secret = Application.get_env(:vostok_server, VostokServerWeb.Endpoint)[:secret_key_base]
    Joken.Signer.create("HS256", secret)
  end
end
