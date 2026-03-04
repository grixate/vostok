defmodule VostokServer.Messaging.MessageRecipient do
  @moduledoc """
  Recipient-specific encrypted envelope for a message.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "message_recipients" do
    field :ciphertext_for_device, :binary

    belongs_to :message, VostokServer.Messaging.Message
    belongs_to :device, VostokServer.Identity.Device

    timestamps(type: :utc_datetime_usec, updated_at: false)
  end

  def changeset(message_recipient, attrs) do
    message_recipient
    |> cast(attrs, [:ciphertext_for_device])
    |> validate_required([:ciphertext_for_device])
    |> unique_constraint(:device_id, name: :message_recipients_message_id_device_id_index)
  end
end
