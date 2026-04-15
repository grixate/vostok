defmodule VostokServer.Repo.Migrations.AddKyberPrekeyFields do
  use Ecto.Migration

  # PQXDH / libsignal v2 migration: each device now publishes a Kyber1024
  # prekey alongside its classic signed prekey. Storing one row per device
  # (not a separate table) matches how libsignal treats the last-resort kyber
  # prekey — single long-lived key rotated on the same schedule as the signed
  # prekey.

  def change do
    alter table(:devices) do
      add :kyber_prekey_id, :integer
      add :kyber_prekey_public, :binary
      add :kyber_prekey_signature, :binary
      add :kyber_prekey_id_counter, :integer, default: 0, null: false
    end
  end
end
