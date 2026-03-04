defmodule VostokServer.Repo.Migrations.CreateMediaUploads do
  use Ecto.Migration

  def change do
    create table(:media_uploads, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :uploader_device_id, references(:devices, type: :binary_id, on_delete: :delete_all),
        null: false

      add :status, :string, null: false
      add :media_kind, :string, null: false
      add :filename, :string, null: false
      add :content_type, :string
      add :declared_byte_size, :bigint, null: false, default: 0
      add :uploaded_byte_size, :bigint, null: false, default: 0
      add :ciphertext, :binary, null: false, default: ""
      add :completed_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create index(:media_uploads, [:uploader_device_id])
    create index(:media_uploads, [:status])
  end
end
