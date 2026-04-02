defmodule VostokServer.Keys.EncryptedBackup do
  @moduledoc """
  Encrypted key backup blob. Client-encrypted, opaque to server.
  Allows restoring Signal Protocol sessions on a new device without
  needing another device online.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "encrypted_key_backups" do
    field :encrypted_blob, :binary
    field :blob_hash, :string
    field :version, :integer, default: 1

    belongs_to :user, VostokServer.Identity.User

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(backup, attrs) do
    backup
    |> cast(attrs, [:user_id, :encrypted_blob, :blob_hash, :version])
    |> validate_required([:user_id, :encrypted_blob, :blob_hash])
    |> unique_constraint(:user_id)
  end
end
