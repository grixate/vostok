defmodule VostokServer.Repo.Migrations.CreateChatSafetyVerifications do
  use Ecto.Migration

  def change do
    create table(:chat_safety_verifications, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :chat_id, references(:chats, type: :binary_id, on_delete: :delete_all), null: false

      add :verifier_device_id, references(:devices, type: :binary_id, on_delete: :delete_all),
        null: false

      add :peer_device_id, references(:devices, type: :binary_id, on_delete: :delete_all),
        null: false

      add :fingerprint, :string, null: false
      add :verified_at, :utc_datetime_usec, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(
             :chat_safety_verifications,
             [:chat_id, :verifier_device_id, :peer_device_id],
             name: :chat_safety_verifications_unique_index
           )

    create index(:chat_safety_verifications, [:chat_id, :verified_at])
    create index(:chat_safety_verifications, [:peer_device_id])
  end
end
