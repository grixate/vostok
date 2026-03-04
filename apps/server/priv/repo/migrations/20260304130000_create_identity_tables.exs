defmodule VostokServer.Repo.Migrations.CreateIdentityTables do
  use Ecto.Migration

  def change do
    create table(:users, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :username, :string, null: false
      add :identity_public_key, :binary, null: false
      add :settings_encrypted, :binary

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:users, [:username])

    create table(:devices, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :device_name, :string, null: false
      add :identity_public_key, :binary, null: false
      add :signed_prekey, :binary
      add :last_active_at, :utc_datetime_usec
      add :revoked_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create index(:devices, [:user_id])

    create table(:one_time_prekeys, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :device_id, references(:devices, type: :binary_id, on_delete: :delete_all), null: false
      add :public_key, :binary, null: false
      add :used_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create index(:one_time_prekeys, [:device_id])
    create index(:one_time_prekeys, [:used_at])

    create table(:device_sessions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :device_id, references(:devices, type: :binary_id, on_delete: :delete_all), null: false
      add :token_hash, :binary, null: false
      add :expires_at, :utc_datetime_usec, null: false
      add :last_seen_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create index(:device_sessions, [:device_id])
    create unique_index(:device_sessions, [:token_hash])

    create table(:invites, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :creator_user_id, references(:users, type: :binary_id, on_delete: :nilify_all)
      add :token_hash, :binary, null: false
      add :expires_at, :utc_datetime_usec, null: false
      add :used_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create index(:invites, [:creator_user_id])
    create unique_index(:invites, [:token_hash])
  end
end
