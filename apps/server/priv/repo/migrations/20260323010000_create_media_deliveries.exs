defmodule VostokServer.Repo.Migrations.CreateMediaDeliveries do
  use Ecto.Migration

  def change do
    create table(:media_deliveries, primary_key: false) do
      add :media_id, references(:media_uploads, type: :binary_id, on_delete: :delete_all),
        null: false
      add :user_id, references(:users, type: :binary_id), null: false
      add :confirmed_at, :utc_datetime_usec, default: fragment("NOW()"), null: false
    end

    create unique_index(:media_deliveries, [:media_id, :user_id])
    create index(:media_deliveries, [:user_id])
  end
end
