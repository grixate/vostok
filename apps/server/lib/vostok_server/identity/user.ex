defmodule VostokServer.Identity.User do
  @moduledoc """
  User account with password-based authentication.

  Encryption keys stay device-scoped, while the user record carries the
  account credentials and profile metadata.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "users" do
    field :username, :string
    field :display_name, :string
    field :bio, :string
    field :password_hash, :string
    field :identity_public_key, :binary
    field :settings_encrypted, :binary
    field :role, :string, default: "member"
    field :status, :string, default: "active"
    field :temp_password, :boolean, default: false
    field :dev, :boolean, default: false
    field :onboarding_completed_at, :utc_datetime_usec
    field :first_message_sent_at, :utc_datetime_usec
    field :last_seen_at, :utc_datetime_usec
    field :profile_photo_path, :string
    field :profile_photo_content_type, :string

    # Virtual field for password (never persisted)
    field :password, :string, virtual: true

    has_many :devices, VostokServer.Identity.Device
    has_many :invites, VostokServer.Identity.Invite, foreign_key: :creator_user_id
    has_many :refresh_tokens, VostokServer.Identity.RefreshToken

    timestamps(type: :utc_datetime_usec)
  end

  @doc "Changeset for device-based registration (legacy, keeps identity_public_key)."
  def changeset(user, attrs) do
    user
    |> cast(attrs, [:username, :identity_public_key, :settings_encrypted])
    |> validate_required([:username])
    |> validate_length(:username, min: 3, max: 32)
    |> unsafe_validate_unique(:username, VostokServer.Repo)
    |> unique_constraint(:username)
  end

  @doc "Changeset for password-based registration."
  def registration_changeset(user, attrs) do
    user
    |> cast(attrs, [:username, :display_name, :password, :role, :dev])
    |> validate_required([:username, :password])
    |> validate_length(:username, min: 3, max: 32)
    |> validate_format(:username, ~r/^[a-z][a-z0-9_]*$/, message: "must start with a letter and contain only lowercase letters, numbers, and underscores")
    |> validate_length(:password, min: 8, max: 128)
    |> validate_length(:display_name, max: 64)
    |> unsafe_validate_unique(:username, VostokServer.Repo)
    |> unique_constraint(:username)
    |> hash_password()
  end

  @doc "Changeset for updating password."
  def password_changeset(user, attrs) do
    user
    |> cast(attrs, [:password, :temp_password])
    |> validate_required([:password])
    |> validate_length(:password, min: 8, max: 128)
    |> hash_password()
  end

  @doc "Changeset for admin actions on user accounts."
  def admin_changeset(user, attrs) do
    user
    |> cast(attrs, [:role, :status, :temp_password, :display_name, :password])
    |> validate_inclusion(:role, ~w(admin member))
    |> validate_inclusion(:status, ~w(active disabled))
    |> maybe_hash_password()
  end

  @doc "Changeset for updating user profile fields."
  def profile_changeset(user, attrs) do
    user
    |> cast(attrs, [:display_name, :bio, :username])
    |> validate_length(:display_name, max: 64)
    |> validate_length(:bio, max: 256)
    |> validate_length(:username, min: 3, max: 32)
    |> validate_format(:username, ~r/^[a-z][a-z0-9_]*$/, message: "must start with a letter and contain only lowercase letters, numbers, and underscores")
    |> unsafe_validate_unique(:username, VostokServer.Repo)
    |> unique_constraint(:username)
  end

  @doc "Changeset for profile photo upload."
  def photo_changeset(user, attrs) do
    user
    |> cast(attrs, [:profile_photo_path, :profile_photo_content_type])
  end

  @doc "Changeset for updating user settings blob."
  def settings_changeset(user, attrs) do
    user
    |> cast(attrs, [:settings_encrypted])
  end

  defp hash_password(%{valid?: true, changes: %{password: password}} = changeset) do
    changeset
    |> put_change(:password_hash, Argon2.hash_pwd_salt(password))
    |> delete_change(:password)
  end

  defp hash_password(changeset), do: changeset

  defp maybe_hash_password(%{changes: %{password: _}} = changeset), do: hash_password(changeset)
  defp maybe_hash_password(changeset), do: changeset
end
