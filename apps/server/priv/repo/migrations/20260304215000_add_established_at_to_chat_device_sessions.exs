defmodule VostokServer.Repo.Migrations.AddEstablishedAtToChatDeviceSessions do
  use Ecto.Migration

  def change do
    alter table(:chat_device_sessions) do
      add :established_at, :utc_datetime_usec
    end
  end
end
