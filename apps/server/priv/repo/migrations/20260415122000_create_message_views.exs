defmodule VostokServer.Repo.Migrations.CreateMessageViews do
  use Ecto.Migration

  def change do
    create table(:message_views, primary_key: false) do
      add :message_id, references(:messages, type: :binary_id, on_delete: :delete_all), null: false
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :viewed_at, :utc_datetime_usec, null: false
    end

    create unique_index(:message_views, [:message_id, :user_id])
    create index(:message_views, [:user_id, :viewed_at])
  end
end
