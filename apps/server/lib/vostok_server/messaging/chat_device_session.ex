defmodule VostokServer.Messaging.ChatDeviceSession do
  @moduledoc """
  Persisted direct-chat session bootstrap metadata between device pairs.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "chat_device_sessions" do
    field :status, :string
    field :initiator_identity_public_key, :binary
    field :initiator_encryption_public_key, :binary
    field :initiator_ephemeral_public_key, :binary
    field :initiator_signed_prekey, :binary
    field :initiator_signed_prekey_signature, :binary
    field :recipient_identity_public_key, :binary
    field :recipient_encryption_public_key, :binary
    field :recipient_signed_prekey, :binary
    field :recipient_signed_prekey_signature, :binary
    field :recipient_one_time_prekey, :binary

    belongs_to :chat, VostokServer.Messaging.Chat
    belongs_to :initiator_device, VostokServer.Identity.Device
    belongs_to :recipient_device, VostokServer.Identity.Device
    belongs_to :recipient_one_time_prekey_record, VostokServer.Identity.OneTimePrekey

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(chat_device_session, attrs) do
    chat_device_session
    |> cast(attrs, [
      :chat_id,
      :initiator_device_id,
      :recipient_device_id,
      :recipient_one_time_prekey_record_id,
      :status,
      :initiator_identity_public_key,
      :initiator_encryption_public_key,
      :initiator_ephemeral_public_key,
      :initiator_signed_prekey,
      :initiator_signed_prekey_signature,
      :recipient_identity_public_key,
      :recipient_encryption_public_key,
      :recipient_signed_prekey,
      :recipient_signed_prekey_signature,
      :recipient_one_time_prekey
    ])
    |> validate_required([
      :chat_id,
      :initiator_device_id,
      :recipient_device_id,
      :status,
      :initiator_identity_public_key,
      :initiator_encryption_public_key,
      :initiator_signed_prekey,
      :initiator_signed_prekey_signature,
      :recipient_identity_public_key,
      :recipient_encryption_public_key,
      :recipient_signed_prekey,
      :recipient_signed_prekey_signature
    ])
    |> validate_inclusion(:status, ["active"])
    |> unique_constraint(
      :recipient_device_id,
      name: :chat_device_sessions_chat_id_initiator_device_id_recipient_device_id_index
    )
  end
end
