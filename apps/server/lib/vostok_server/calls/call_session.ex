defmodule VostokServer.Calls.CallSession do
  @moduledoc """
  Persisted call session lifecycle record.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "call_sessions" do
    field :mode, :string
    field :media_mode, :string
    field :status, :string
    field :scope_type, :string
    field :scope_id, :binary_id
    field :started_at, :utc_datetime_usec
    field :ended_at, :utc_datetime_usec
    field :end_reason, :string

    belongs_to :chat, VostokServer.Messaging.Chat
    belongs_to :call_room, VostokServer.Calls.CallRoom
    belongs_to :started_by_device, VostokServer.Identity.Device

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(call_session, attrs) do
    call_session
    |> cast(attrs, [
      :chat_id,
      :call_room_id,
      :scope_type,
      :scope_id,
      :started_by_device_id,
      :mode,
      :media_mode,
      :status,
      :started_at,
      :ended_at,
      :end_reason
    ])
    |> validate_required([:scope_type, :scope_id, :started_by_device_id, :mode, :media_mode, :status, :started_at])
    |> validate_inclusion(:mode, ["voice", "video", "group"])
    |> validate_inclusion(:media_mode, ["voice", "video"])
    |> validate_inclusion(:status, ["ringing", "active", "ended"])
    |> validate_inclusion(:scope_type, ["chat", "call_room"])
    |> validate_scope_reference()
  end

  defp validate_scope_reference(changeset) do
    scope_type = get_field(changeset, :scope_type)
    chat_id = get_field(changeset, :chat_id)
    call_room_id = get_field(changeset, :call_room_id)
    case scope_type do
      "chat" ->
        changeset
        |> validate_required([:chat_id])
        |> validate_change(:scope_id, fn :scope_id, value ->
          if value == chat_id, do: [], else: [scope_id: "must match chat_id"]
        end)

      "call_room" ->
        changeset
        |> validate_required([:call_room_id])
        |> validate_change(:scope_id, fn :scope_id, value ->
          if value == call_room_id, do: [], else: [scope_id: "must match call_room_id"]
        end)

      _ ->
        changeset
    end
  end
end
