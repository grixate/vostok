defmodule VostokServer.Repo.Migrations.CreateStoragePolicies do
  use Ecto.Migration

  def change do
    create table(:storage_policies, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :scope_type, :string, size: 20, null: false
      add :scope_value, :string, size: 255
      add :policy_json, :map, null: false
      add :created_by, references(:users, type: :binary_id)
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:storage_policies, [:scope_type, :scope_value])
  end
end
