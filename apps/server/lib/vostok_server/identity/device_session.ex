defmodule VostokServer.Identity.DeviceSession do
  @moduledoc """
  Persisted session records for REST and WebSocket device authentication.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "device_sessions" do
    field :token_hash, :binary
    field :expires_at, :utc_datetime_usec
    field :last_seen_at, :utc_datetime_usec

    belongs_to :device, VostokServer.Identity.Device

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(device_session, attrs) do
    device_session
    |> cast(attrs, [:token_hash, :expires_at, :last_seen_at])
    |> validate_required([:token_hash, :expires_at])
  end
end
