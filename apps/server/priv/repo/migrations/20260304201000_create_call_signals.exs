defmodule VostokServer.Repo.Migrations.CreateCallSignals do
  use Ecto.Migration

  def change do
    create table(:call_signals, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :call_id, references(:call_sessions, type: :binary_id, on_delete: :delete_all),
        null: false

      add :from_device_id, references(:devices, type: :binary_id, on_delete: :delete_all),
        null: false

      add :target_device_id, references(:devices, type: :binary_id, on_delete: :nilify_all)
      add :signal_type, :string, null: false
      add :payload, :text, null: false

      timestamps(type: :utc_datetime_usec, updated_at: false)
    end

    create index(:call_signals, [:call_id, :inserted_at])
    create index(:call_signals, [:call_id, :target_device_id])
  end
end
