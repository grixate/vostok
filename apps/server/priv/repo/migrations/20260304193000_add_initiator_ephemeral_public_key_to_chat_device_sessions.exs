defmodule VostokServer.Repo.Migrations.AddInitiatorEphemeralPublicKeyToChatDeviceSessions do
  use Ecto.Migration

  def change do
    alter table(:chat_device_sessions) do
      add :initiator_ephemeral_public_key, :binary
    end
  end
end
