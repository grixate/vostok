defmodule VostokServer.Messaging.ChatReadState do
  @moduledoc """
  Per-device read cursor for chat timelines.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "chat_read_states" do
    field :read_at, :utc_datetime_usec

    belongs_to :chat, VostokServer.Messaging.Chat
    belongs_to :device, VostokServer.Identity.Device
    belongs_to :last_read_message, VostokServer.Messaging.Message

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(chat_read_state, attrs) do
    chat_read_state
    |> cast(attrs, [:chat_id, :device_id, :last_read_message_id, :read_at])
    |> validate_required([:chat_id, :device_id, :read_at])
  end
end
