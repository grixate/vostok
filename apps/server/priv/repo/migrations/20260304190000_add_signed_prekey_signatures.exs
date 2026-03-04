defmodule VostokServer.Repo.Migrations.AddSignedPrekeySignatures do
  use Ecto.Migration

  def change do
    alter table(:devices) do
      add :signed_prekey_signature, :binary
    end

    alter table(:chat_device_sessions) do
      add :initiator_signed_prekey_signature, :binary
      add :recipient_signed_prekey_signature, :binary
    end
  end
end
