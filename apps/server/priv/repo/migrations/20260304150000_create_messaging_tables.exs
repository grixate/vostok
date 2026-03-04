defmodule VostokServer.Repo.Migrations.CreateMessagingTables do
  use Ecto.Migration

  def change do
    create table(:chats, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :type, :string, null: false
      add :direct_key, :string
      add :metadata_encrypted, :binary

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:chats, [:direct_key], where: "direct_key IS NOT NULL")

    create table(:chat_members, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :chat_id, references(:chats, type: :binary_id, on_delete: :delete_all), null: false
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :role, :string, null: false
      add :joined_at, :utc_datetime_usec, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:chat_members, [:chat_id, :user_id])
    create index(:chat_members, [:user_id])

    create table(:messages, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :chat_id, references(:chats, type: :binary_id, on_delete: :delete_all), null: false

      add :sender_device_id, references(:devices, type: :binary_id, on_delete: :delete_all),
        null: false

      add :client_id, :string, null: false
      add :header, :binary
      add :ciphertext, :binary, null: false
      add :message_kind, :string, null: false

      timestamps(type: :utc_datetime_usec, updated_at: false)
    end

    create unique_index(:messages, [:client_id])
    create index(:messages, [:chat_id, :inserted_at])
    create index(:messages, [:sender_device_id])

    create table(:message_recipients, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :message_id, references(:messages, type: :binary_id, on_delete: :delete_all),
        null: false

      add :device_id, references(:devices, type: :binary_id, on_delete: :delete_all), null: false
      add :ciphertext_for_device, :binary, null: false

      timestamps(type: :utc_datetime_usec, updated_at: false)
    end

    create unique_index(:message_recipients, [:message_id, :device_id])
    create index(:message_recipients, [:device_id])
  end
end
