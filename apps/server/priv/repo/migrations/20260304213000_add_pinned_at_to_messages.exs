defmodule VostokServer.Repo.Migrations.AddPinnedAtToMessages do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :pinned_at, :utc_datetime_usec
    end
  end
end
