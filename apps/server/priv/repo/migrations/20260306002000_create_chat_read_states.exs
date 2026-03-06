defmodule VostokServer.Repo.Migrations.CreateChatReadStates do
  use Ecto.Migration

  def change do
    create table(:chat_read_states, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :chat_id, references(:chats, type: :binary_id, on_delete: :delete_all), null: false
      add :device_id, references(:devices, type: :binary_id, on_delete: :delete_all), null: false
      add :last_read_message_id, references(:messages, type: :binary_id, on_delete: :nilify_all)
      add :read_at, :utc_datetime_usec, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:chat_read_states, [:chat_id, :device_id])
    create index(:chat_read_states, [:device_id, :read_at])
  end
end
