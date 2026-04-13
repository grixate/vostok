defmodule VostokServer.Repo.Migrations.AddSignalProtocolFields do
  use Ecto.Migration

  def change do
    alter table(:devices) do
      add :registration_id, :integer
      add :signed_prekey_id_counter, :integer, default: 0
      add :one_time_prekey_id_counter, :integer, default: 0
    end

    alter table(:one_time_prekeys) do
      add :key_id, :integer
    end
  end
end
