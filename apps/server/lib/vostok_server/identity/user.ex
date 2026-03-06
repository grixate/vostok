defmodule VostokServer.Identity.User do
  @moduledoc """
  User profile metadata for the first identity slice.

  Encryption keys stay device-scoped, while the user record carries the public
  identity handle and encrypted settings envelope.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "users" do
    field :username, :string
    field :identity_public_key, :binary
    field :settings_encrypted, :binary
    field :is_admin, :boolean, default: false

    has_many :devices, VostokServer.Identity.Device
    has_many :invites, VostokServer.Identity.Invite, foreign_key: :creator_user_id

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(user, attrs) do
    user
    |> cast(attrs, [:username, :identity_public_key, :settings_encrypted, :is_admin])
    |> validate_required([:username, :identity_public_key])
    |> validate_length(:username, min: 3, max: 32)
    |> unsafe_validate_unique(:username, VostokServer.Repo)
    |> unique_constraint(:username)
  end
end
