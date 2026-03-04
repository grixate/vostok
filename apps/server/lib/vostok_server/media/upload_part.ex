defmodule VostokServer.Media.UploadPart do
  @moduledoc """
  Chunk-level persisted ciphertext part for resumable attachment uploads.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "media_upload_parts" do
    field :part_index, :integer
    field :chunk_ciphertext, :binary
    field :byte_size, :integer
    field :sha256, :string

    belongs_to :upload, VostokServer.Media.Upload

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(upload_part, attrs) do
    upload_part
    |> cast(attrs, [:upload_id, :part_index, :chunk_ciphertext, :byte_size, :sha256])
    |> validate_required([:upload_id, :part_index, :chunk_ciphertext, :byte_size, :sha256])
    |> validate_number(:part_index, greater_than_or_equal_to: 0)
    |> validate_number(:byte_size, greater_than_or_equal_to: 0)
    |> validate_length(:sha256, is: 64)
    |> unique_constraint(:part_index)
  end
end
