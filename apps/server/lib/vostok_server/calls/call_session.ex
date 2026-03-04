defmodule VostokServer.Calls.CallSession do
  @moduledoc """
  Minimal call session record for Stage 7 HTTP signaling scaffolding.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "call_sessions" do
    field :mode, :string
    field :status, :string
    field :started_at, :utc_datetime_usec
    field :ended_at, :utc_datetime_usec

    belongs_to :chat, VostokServer.Messaging.Chat
    belongs_to :started_by_device, VostokServer.Identity.Device

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(call_session, attrs) do
    call_session
    |> cast(attrs, [:chat_id, :started_by_device_id, :mode, :status, :started_at, :ended_at])
    |> validate_required([:chat_id, :started_by_device_id, :mode, :status, :started_at])
    |> validate_inclusion(:mode, ["voice", "video", "group"])
    |> validate_inclusion(:status, ["active", "ended"])
  end
end
