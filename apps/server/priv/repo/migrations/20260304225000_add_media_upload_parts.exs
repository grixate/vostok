defmodule VostokServer.Repo.Migrations.AddMediaUploadParts do
  use Ecto.Migration

  def change do
    alter table(:media_uploads) do
      add :expected_part_count, :integer
    end

    create table(:media_upload_parts, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :upload_id, references(:media_uploads, type: :binary_id, on_delete: :delete_all),
        null: false

      add :part_index, :integer, null: false
      add :chunk_ciphertext, :binary, null: false
      add :byte_size, :integer, null: false
      add :sha256, :string, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:media_upload_parts, [:upload_id, :part_index])
    create index(:media_upload_parts, [:upload_id])
  end
end
