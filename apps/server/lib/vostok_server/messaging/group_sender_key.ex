defmodule VostokServer.Messaging.GroupSenderKey do
  @moduledoc """
  Wrapped Sender Key distribution record for a group recipient device.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "group_sender_keys" do
    field :key_id, :string
    field :sender_key_epoch, :integer
    field :wrapped_sender_key, :binary
    field :algorithm, :string
    field :status, :string

    belongs_to :chat, VostokServer.Messaging.Chat
    belongs_to :owner_device, VostokServer.Identity.Device
    belongs_to :recipient_device, VostokServer.Identity.Device

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(group_sender_key, attrs) do
    group_sender_key
    |> cast(attrs, [
      :chat_id,
      :owner_device_id,
      :recipient_device_id,
      :key_id,
      :sender_key_epoch,
      :wrapped_sender_key,
      :algorithm,
      :status
    ])
    |> validate_required([
      :chat_id,
      :owner_device_id,
      :recipient_device_id,
      :key_id,
      :sender_key_epoch,
      :wrapped_sender_key,
      :algorithm,
      :status
    ])
    |> validate_inclusion(:status, ["active", "superseded"])
    |> validate_number(:sender_key_epoch, greater_than_or_equal_to: 0)
    |> validate_length(:key_id, min: 1, max: 255)
    |> validate_length(:algorithm, min: 1, max: 128)
    |> unique_constraint(:key_id, name: :group_sender_keys_unique_distribution_index)
  end
end
