defmodule VostokServer.Repo.Migrations.AddCallRoomsAndScopeToCalls do
  use Ecto.Migration

  def change do
    create table(:call_rooms, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :title, :string, null: false
      add :created_by_user_id, references(:users, type: :binary_id, on_delete: :delete_all),
        null: false
      add :expires_at, :utc_datetime_usec, null: false
      add :closed_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create index(:call_rooms, [:created_by_user_id])
    create index(:call_rooms, [:expires_at])

    create table(:call_room_members, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :call_room_id, references(:call_rooms, type: :binary_id, on_delete: :delete_all),
        null: false
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :role, :string, null: false
      add :joined_at, :utc_datetime_usec, null: false
      add :left_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:call_room_members, [:call_room_id, :user_id])
    create index(:call_room_members, [:user_id])

    alter table(:call_sessions) do
      modify :chat_id, :binary_id, null: true
      add :call_room_id, references(:call_rooms, type: :binary_id, on_delete: :delete_all)
      add :scope_type, :string, null: false, default: "chat"
      add :scope_id, :binary_id
      add :media_mode, :string
    end

    execute("UPDATE call_sessions SET scope_type = 'chat', scope_id = chat_id, media_mode = mode")

    alter table(:call_sessions) do
      modify :scope_id, :binary_id, null: false
      modify :media_mode, :string, null: false
    end

    create index(:call_sessions, [:call_room_id, :status])
    create index(:call_sessions, [:scope_type, :scope_id, :status])
  end
end
