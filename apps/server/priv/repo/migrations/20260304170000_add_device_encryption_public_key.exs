defmodule VostokServer.Repo.Migrations.AddDeviceEncryptionPublicKey do
  use Ecto.Migration

  def change do
    alter table(:devices) do
      add :encryption_public_key, :binary
    end
  end
end
