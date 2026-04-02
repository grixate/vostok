defmodule VostokServer.Repo.Migrations.CreateEncryptedKeyBackups do
  use Ecto.Migration

  def change do
    create table(:encrypted_key_backups, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :encrypted_blob, :binary, null: false
      add :blob_hash, :string, null: false
      add :version, :integer, default: 1, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:encrypted_key_backups, [:user_id])
  end
end
