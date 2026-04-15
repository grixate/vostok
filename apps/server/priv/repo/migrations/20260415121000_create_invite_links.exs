defmodule VostokServer.Repo.Migrations.CreateInviteLinks do
  use Ecto.Migration

  def change do
    create table(:invite_links, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :chat_id, references(:chats, type: :binary_id, on_delete: :delete_all), null: false
      add :code, :string, null: false
      add :created_by_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :expires_at, :utc_datetime_usec
      add :max_uses, :integer
      add :use_count, :integer, default: 0, null: false
      add :revoked_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:invite_links, [:code])
    create index(:invite_links, [:chat_id])
    create index(:invite_links, [:created_by_id])
  end
end
