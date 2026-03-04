defmodule VostokServer.Repo.Migrations.CreateChatDeviceSessions do
  use Ecto.Migration

  def change do
    create table(:chat_device_sessions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :chat_id, references(:chats, type: :binary_id, on_delete: :delete_all), null: false

      add :initiator_device_id, references(:devices, type: :binary_id, on_delete: :delete_all),
        null: false

      add :recipient_device_id, references(:devices, type: :binary_id, on_delete: :delete_all),
        null: false

      add :recipient_one_time_prekey_record_id,
          references(:one_time_prekeys, type: :binary_id, on_delete: :nilify_all)

      add :status, :string, null: false
      add :initiator_identity_public_key, :binary, null: false
      add :initiator_encryption_public_key, :binary, null: false
      add :initiator_signed_prekey, :binary, null: false
      add :recipient_identity_public_key, :binary, null: false
      add :recipient_encryption_public_key, :binary, null: false
      add :recipient_signed_prekey, :binary, null: false
      add :recipient_one_time_prekey, :binary

      timestamps(type: :utc_datetime_usec)
    end

    create index(:chat_device_sessions, [:chat_id])
    create index(:chat_device_sessions, [:initiator_device_id])
    create index(:chat_device_sessions, [:recipient_device_id])

    create unique_index(
             :chat_device_sessions,
             [:chat_id, :initiator_device_id, :recipient_device_id]
           )
  end
end
