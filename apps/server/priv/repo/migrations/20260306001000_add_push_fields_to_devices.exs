defmodule VostokServer.Repo.Migrations.AddPushFieldsToDevices do
  use Ecto.Migration

  def change do
    alter table(:devices) do
      add :push_provider, :string
      add :push_token, :string
      add :push_token_updated_at, :utc_datetime_usec
    end

    create index(:devices, [:push_provider])
  end
end
