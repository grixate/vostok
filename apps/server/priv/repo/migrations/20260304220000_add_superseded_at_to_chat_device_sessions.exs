defmodule VostokServer.Repo.Migrations.AddSupersededAtToChatDeviceSessions do
  use Ecto.Migration

  @session_pair_index :chat_device_sessions_chat_id_initiator_device_id_recipient_device_id_index

  def change do
    alter table(:chat_device_sessions) do
      add :superseded_at, :utc_datetime_usec
    end

    drop_if_exists index(
                     :chat_device_sessions,
                     [:chat_id, :initiator_device_id, :recipient_device_id],
                     name: @session_pair_index
                   )

    create unique_index(
             :chat_device_sessions,
             [:chat_id, :initiator_device_id, :recipient_device_id],
             name: @session_pair_index,
             where: "superseded_at IS NULL"
           )
  end
end
