defmodule VostokServer.Messaging.Chat do
  @moduledoc """
  Conversation container for direct chats.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "chats" do
    field :type, :string
    field :direct_key, :string
    field :metadata_encrypted, :binary

    has_many :members, VostokServer.Messaging.ChatMember
    has_many :messages, VostokServer.Messaging.Message
    has_many :device_sessions, VostokServer.Messaging.ChatDeviceSession

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(chat, attrs) do
    chat
    |> cast(attrs, [:type, :direct_key, :metadata_encrypted])
    |> validate_required([:type])
    |> validate_inclusion(:type, ["direct", "group", "channel"])
    |> unique_constraint(:direct_key)
  end
end
