defmodule VostokServer.Repo.Migrations.CreateCallKeyDistributions do
  use Ecto.Migration

  def change do
    create table(:call_key_distributions, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :call_id, references(:call_sessions, type: :binary_id, on_delete: :delete_all),
        null: false

      add :owner_device_id, references(:devices, type: :binary_id, on_delete: :delete_all),
        null: false

      add :recipient_device_id, references(:devices, type: :binary_id, on_delete: :delete_all),
        null: false

      add :key_epoch, :integer, null: false
      add :algorithm, :string, null: false
      add :wrapped_key, :binary, null: false
      add :status, :string, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create index(:call_key_distributions, [:call_id, :recipient_device_id])

    create unique_index(
             :call_key_distributions,
             [:call_id, :owner_device_id, :recipient_device_id, :key_epoch],
             name: :call_key_distributions_unique_epoch_index
           )
  end
end
