defmodule VostokServer.Identity.Device do
  @moduledoc """
  Per-device public key material and connection metadata.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "devices" do
    field :device_name, :string
    field :identity_public_key, :binary
    field :encryption_public_key, :binary
    field :signed_prekey, :binary
    field :signed_prekey_signature, :binary
    field :last_active_at, :utc_datetime_usec
    field :revoked_at, :utc_datetime_usec

    belongs_to :user, VostokServer.Identity.User
    has_many :one_time_prekeys, VostokServer.Identity.OneTimePrekey
    has_many :device_sessions, VostokServer.Identity.DeviceSession

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(device, attrs) do
    device
    |> cast(attrs, [
      :device_name,
      :identity_public_key,
      :encryption_public_key,
      :signed_prekey,
      :signed_prekey_signature,
      :last_active_at,
      :revoked_at
    ])
    |> validate_required([:device_name, :identity_public_key])
    |> validate_length(:device_name, min: 1, max: 64)
  end
end
