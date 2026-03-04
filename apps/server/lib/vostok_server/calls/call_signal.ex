defmodule VostokServer.Calls.CallSignal do
  @moduledoc """
  Persisted call signaling event used to exchange WebRTC bootstrap payloads
  around the future Membrane RTC Engine integration.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "call_signals" do
    field :signal_type, :string
    field :payload, :string

    belongs_to :call, VostokServer.Calls.CallSession
    belongs_to :from_device, VostokServer.Identity.Device
    belongs_to :target_device, VostokServer.Identity.Device

    timestamps(type: :utc_datetime_usec, updated_at: false)
  end

  def changeset(call_signal, attrs) do
    call_signal
    |> cast(attrs, [:call_id, :from_device_id, :target_device_id, :signal_type, :payload])
    |> validate_required([:call_id, :from_device_id, :signal_type, :payload])
    |> validate_inclusion(:signal_type, ["offer", "answer", "ice", "renegotiate", "heartbeat"])
    |> validate_length(:payload, min: 2, max: 32_768)
  end
end
