defmodule VostokServer.Repo.Migrations.CreateFederationDeliveryJobs do
  use Ecto.Migration

  def change do
    create table(:federation_delivery_jobs, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :peer_id, references(:federation_peers, type: :binary_id, on_delete: :delete_all),
        null: false

      add :direction, :string, null: false
      add :event_type, :string, null: false
      add :status, :string, null: false
      add :payload, :map, null: false
      add :attempt_count, :integer, null: false, default: 0
      add :available_at, :utc_datetime_usec, null: false
      add :last_attempted_at, :utc_datetime_usec
      add :delivered_at, :utc_datetime_usec
      add :last_error, :text

      timestamps(type: :utc_datetime_usec)
    end

    create index(:federation_delivery_jobs, [:peer_id])
    create index(:federation_delivery_jobs, [:status])
    create index(:federation_delivery_jobs, [:available_at])
  end
end
