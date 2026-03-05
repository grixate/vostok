defmodule VostokServer.Messaging.ChatSafetyVerification do
  @moduledoc """
  Persisted safety-number verification acknowledgements per chat/device pair.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "chat_safety_verifications" do
    field :fingerprint, :string
    field :verified_at, :utc_datetime_usec

    belongs_to :chat, VostokServer.Messaging.Chat
    belongs_to :verifier_device, VostokServer.Identity.Device
    belongs_to :peer_device, VostokServer.Identity.Device

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(chat_safety_verification, attrs) do
    chat_safety_verification
    |> cast(attrs, [:chat_id, :verifier_device_id, :peer_device_id, :fingerprint, :verified_at])
    |> validate_required([
      :chat_id,
      :verifier_device_id,
      :peer_device_id,
      :fingerprint,
      :verified_at
    ])
    |> unique_constraint(
      :peer_device_id,
      name: :chat_safety_verifications_unique_index
    )
  end
end
