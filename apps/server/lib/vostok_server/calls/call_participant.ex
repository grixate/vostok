defmodule VostokServer.Calls.CallParticipant do
  @moduledoc """
  Persisted participant state for a call session.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "call_participants" do
    field :status, :string
    field :track_kind, :string
    field :joined_at, :utc_datetime_usec
    field :left_at, :utc_datetime_usec

    belongs_to :call, VostokServer.Calls.CallSession
    belongs_to :user, VostokServer.Identity.User
    belongs_to :device, VostokServer.Identity.Device

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(call_participant, attrs) do
    call_participant
    |> cast(attrs, [:call_id, :user_id, :device_id, :status, :track_kind, :joined_at, :left_at])
    |> validate_required([:call_id, :user_id, :device_id, :status, :track_kind, :joined_at])
    |> validate_inclusion(:status, ["joined", "left"])
    |> validate_inclusion(:track_kind, ["audio", "video", "audio_video"])
    |> unique_constraint(:device_id, name: :call_participants_call_id_device_id_index)
  end
end
