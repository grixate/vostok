defmodule VostokServer.Repo.Migrations.RefactorAuthToPassword do
  use Ecto.Migration

  def change do
    # ── Users table: add password-based auth fields ──────────────────────
    alter table(:users) do
      add :password_hash, :string
      add :display_name, :string
      add :role, :string, default: "member", null: false
      add :status, :string, default: "active", null: false
      add :temp_password, :boolean, default: false, null: false
      add :dev, :boolean, default: false, null: false
      add :onboarding_completed_at, :utc_datetime_usec
      add :first_message_sent_at, :utc_datetime_usec
      add :last_seen_at, :utc_datetime_usec
    end

    # identity_public_key is no longer required at registration
    # (set later when device registers for E2E encryption)
    execute "ALTER TABLE users ALTER COLUMN identity_public_key DROP NOT NULL",
            "ALTER TABLE users ALTER COLUMN identity_public_key SET NOT NULL"

    # ── Invites table: expand for new invite model ───────────────────────
    alter table(:invites) do
      add :code, :string
      add :label, :string
      add :status, :string, default: "pending", null: false
      add :used_by, references(:users, type: :binary_id, on_delete: :nilify_all)
      add :revoked_at, :utc_datetime_usec
    end

    create index(:invites, [:code])
    create index(:invites, [:status])

    # ── Refresh tokens ───────────────────────────────────────────────────
    create table(:refresh_tokens, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :token_hash, :binary, null: false
      add :device_info, :string
      add :ip_address, :string
      add :expires_at, :utc_datetime_usec, null: false
      add :revoked_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create index(:refresh_tokens, [:user_id])
    create unique_index(:refresh_tokens, [:token_hash])

    # ── Access requests ──────────────────────────────────────────────────
    create table(:access_requests, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, null: false
      add :message, :string
      add :ip_address, :string
      add :ip_location, :string
      add :status, :string, default: "pending", null: false
      add :reviewed_by, references(:users, type: :binary_id, on_delete: :nilify_all)
      add :invite_id, references(:invites, type: :binary_id, on_delete: :nilify_all)

      timestamps(type: :utc_datetime_usec)
    end

    create index(:access_requests, [:status])

    # ── Password reset requests ──────────────────────────────────────────
    create table(:password_reset_requests, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :message, :string
      add :status, :string, default: "pending", null: false
      add :reviewed_by, references(:users, type: :binary_id, on_delete: :nilify_all)

      timestamps(type: :utc_datetime_usec)
    end

    create index(:password_reset_requests, [:user_id])
    create index(:password_reset_requests, [:status])

    # ── Server settings (key-value store for admin config) ───────────────
    create table(:server_settings, primary_key: false) do
      add :key, :string, primary_key: true
      add :value, :string

      timestamps(type: :utc_datetime_usec)
    end
  end
end
