defmodule VostokServer.Messaging.Message do
  @moduledoc """
  Opaque encrypted message envelope persisted by the server.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "messages" do
    field :client_id, :string
    field :header, :binary
    field :ciphertext, :binary
    field :message_kind, :string
    field :crypto_scheme, :string
    field :sender_key_id, :string
    field :sender_key_epoch, :integer
    field :pinned_at, :utc_datetime_usec
    field :edited_at, :utc_datetime_usec
    field :deleted_at, :utc_datetime_usec

    belongs_to :chat, VostokServer.Messaging.Chat
    belongs_to :sender_device, VostokServer.Identity.Device
    belongs_to :reply_to_message, __MODULE__
    has_many :recipient_envelopes, VostokServer.Messaging.MessageRecipient
    has_many :reactions, VostokServer.Messaging.MessageReaction

    timestamps(type: :utc_datetime_usec, updated_at: false)
  end

  def changeset(message, attrs) do
    message
    |> cast(attrs, [
      :client_id,
      :header,
      :ciphertext,
      :message_kind,
      :crypto_scheme,
      :sender_key_id,
      :sender_key_epoch,
      :pinned_at,
      :reply_to_message_id,
      :edited_at,
      :deleted_at
    ])
    |> validate_required([:client_id, :ciphertext, :message_kind])
    |> validate_inclusion(:message_kind, ["text", "system", "media", "attachment"])
    |> assoc_constraint(:reply_to_message)
    |> unique_constraint(:client_id)
  end
end
