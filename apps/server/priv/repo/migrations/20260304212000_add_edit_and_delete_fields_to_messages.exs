defmodule VostokServer.Repo.Migrations.AddEditAndDeleteFieldsToMessages do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :edited_at, :utc_datetime_usec
      add :deleted_at, :utc_datetime_usec
    end

    create index(:messages, [:edited_at])
    create index(:messages, [:deleted_at])
  end
end
