defmodule VostokServer.Auth.Password do
  @moduledoc """
  Password hashing and verification using Argon2id.
  """

  def hash(password) when is_binary(password) do
    Argon2.hash_pwd_salt(password)
  end

  def verify(password, hash) when is_binary(password) and is_binary(hash) do
    Argon2.verify_pass(password, hash)
  end

  def verify(_password, _hash), do: false

  @doc "Generates a 12-character alphanumeric temporary password."
  def generate_temp_password do
    :crypto.strong_rand_bytes(9)
    |> Base.encode64(padding: false)
    |> binary_part(0, 12)
  end
end
