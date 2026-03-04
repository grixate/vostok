defmodule VostokServer.Repo.Migrations.CreateFederationPeers do
  use Ecto.Migration

  def change do
    create table(:federation_peers, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :domain, :string, null: false
      add :display_name, :string
      add :status, :string, null: false
      add :last_error, :text
      add :last_seen_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:federation_peers, [:domain])
    create index(:federation_peers, [:status])
  end
end
