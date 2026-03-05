defmodule VostokServer.Calls.CallKeyDistribution do
  @moduledoc """
  Per-recipient wrapped call key material by epoch for group-call E2EE signaling.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "call_key_distributions" do
    field :key_epoch, :integer
    field :algorithm, :string
    field :wrapped_key, :binary
    field :status, :string

    belongs_to :call, VostokServer.Calls.CallSession
    belongs_to :owner_device, VostokServer.Identity.Device
    belongs_to :recipient_device, VostokServer.Identity.Device

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(call_key_distribution, attrs) do
    call_key_distribution
    |> cast(attrs, [
      :call_id,
      :owner_device_id,
      :recipient_device_id,
      :key_epoch,
      :algorithm,
      :wrapped_key,
      :status
    ])
    |> validate_required([
      :call_id,
      :owner_device_id,
      :recipient_device_id,
      :key_epoch,
      :algorithm,
      :wrapped_key,
      :status
    ])
    |> validate_number(:key_epoch, greater_than_or_equal_to: 0)
    |> validate_inclusion(:status, ["active", "superseded"])
    |> validate_length(:algorithm, min: 1, max: 128)
    |> unique_constraint(:key_epoch, name: :call_key_distributions_unique_epoch_index)
  end
end
