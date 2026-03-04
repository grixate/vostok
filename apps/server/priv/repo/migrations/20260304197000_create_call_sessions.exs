defmodule VostokServer.Repo.Migrations.CreateCallSessions do
  use Ecto.Migration

  def change do
    create table(:call_sessions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :chat_id, references(:chats, type: :binary_id, on_delete: :delete_all), null: false

      add :started_by_device_id, references(:devices, type: :binary_id, on_delete: :delete_all),
        null: false

      add :mode, :string, null: false
      add :status, :string, null: false
      add :started_at, :utc_datetime_usec, null: false
      add :ended_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create index(:call_sessions, [:chat_id, :status])
    create index(:call_sessions, [:started_by_device_id])
  end
end
