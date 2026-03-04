defmodule VostokServer.Repo.Migrations.CreateCallParticipants do
  use Ecto.Migration

  def change do
    create table(:call_participants, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :call_id, references(:call_sessions, type: :binary_id, on_delete: :delete_all),
        null: false

      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :device_id, references(:devices, type: :binary_id, on_delete: :delete_all), null: false
      add :status, :string, null: false
      add :track_kind, :string, null: false
      add :joined_at, :utc_datetime_usec, null: false
      add :left_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:call_participants, [:call_id, :device_id])
    create index(:call_participants, [:call_id, :status])
  end
end
