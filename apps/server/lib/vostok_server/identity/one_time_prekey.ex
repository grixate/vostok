defmodule VostokServer.Identity.OneTimePrekey do
  @moduledoc """
  Public one-time prekey bundle members consumed during X3DH bootstrap.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "one_time_prekeys" do
    field :public_key, :binary
    field :used_at, :utc_datetime_usec

    belongs_to :device, VostokServer.Identity.Device

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(prekey, attrs) do
    prekey
    |> cast(attrs, [:public_key, :used_at])
    |> validate_required([:public_key])
  end
end
