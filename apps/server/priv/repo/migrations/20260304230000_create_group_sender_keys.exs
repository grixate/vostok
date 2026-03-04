defmodule VostokServer.Repo.Migrations.CreateGroupSenderKeys do
  use Ecto.Migration

  def change do
    create table(:group_sender_keys, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :chat_id, references(:chats, type: :binary_id, on_delete: :delete_all), null: false

      add :owner_device_id, references(:devices, type: :binary_id, on_delete: :delete_all),
        null: false

      add :recipient_device_id, references(:devices, type: :binary_id, on_delete: :delete_all),
        null: false

      add :key_id, :string, null: false
      add :wrapped_sender_key, :binary, null: false
      add :algorithm, :string, null: false
      add :status, :string, null: false, default: "active"

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(
             :group_sender_keys,
             [:chat_id, :owner_device_id, :recipient_device_id, :key_id],
             name: :group_sender_keys_unique_distribution_index
           )

    create index(:group_sender_keys, [:chat_id, :recipient_device_id, :status])
    create index(:group_sender_keys, [:chat_id, :owner_device_id, :status])
  end
end
