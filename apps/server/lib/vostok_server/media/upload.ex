defmodule VostokServer.Media.Upload do
  @moduledoc """
  Opaque encrypted media payload stored by the server.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "media_uploads" do
    field :status, :string
    field :media_kind, :string
    field :filename, :string
    field :content_type, :string
    field :declared_byte_size, :integer
    field :uploaded_byte_size, :integer
    field :expected_part_count, :integer
    field :ciphertext, :binary
    field :ciphertext_sha256, :string
    field :completed_at, :utc_datetime_usec

    # Storage tier fields
    field :hot_cache_path, :string
    field :object_key, :string
    field :storage_tier, :string, default: "hot"
    field :media_status, :string, default: "available"
    field :evicted_at, :utc_datetime_usec
    field :last_accessed_at, :utc_datetime_usec
    field :recipient_count, :integer, default: 0
    field :confirmed_count, :integer, default: 0
    field :fully_delivered, :boolean, default: false
    field :fully_delivered_at, :utc_datetime_usec

    belongs_to :uploader_device, VostokServer.Identity.Device
    has_many :parts, VostokServer.Media.UploadPart

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(upload, attrs) do
    upload
    |> cast(attrs, [
      :uploader_device_id,
      :status,
      :media_kind,
      :filename,
      :content_type,
      :declared_byte_size,
      :uploaded_byte_size,
      :expected_part_count,
      :ciphertext,
      :ciphertext_sha256,
      :completed_at,
      :hot_cache_path,
      :object_key,
      :storage_tier,
      :media_status,
      :evicted_at,
      :last_accessed_at,
      :recipient_count,
      :confirmed_count,
      :fully_delivered,
      :fully_delivered_at
    ])
    |> validate_required([:uploader_device_id, :status, :media_kind, :filename])
    |> validate_inclusion(:status, ["pending", "completed"])
    |> validate_inclusion(:media_kind, ["file", "image", "audio", "video"])
    |> validate_number(:declared_byte_size, greater_than_or_equal_to: 0)
    |> validate_number(:uploaded_byte_size, greater_than_or_equal_to: 0)
    |> validate_number(:expected_part_count, greater_than: 0)
    |> validate_length(:filename, min: 1, max: 255)
    |> validate_length(:ciphertext_sha256, is: 64)
  end
end
