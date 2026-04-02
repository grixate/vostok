defmodule VostokServer.Repo.Migrations.AddExpiresAtToMessages do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :expires_at, :utc_datetime_usec
    end

    create index(:messages, [:expires_at], where: "expires_at IS NOT NULL")

    # Backfill existing messages with a generous 30-day TTL
    execute(
      "UPDATE messages SET expires_at = inserted_at + interval '30 days' WHERE expires_at IS NULL",
      "UPDATE messages SET expires_at = NULL"
    )
  end
end
