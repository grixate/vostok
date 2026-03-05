defmodule VostokServer.Repo.Migrations.AddSenderKeyEpochToGroupSenderKeys do
  use Ecto.Migration

  def change do
    alter table(:group_sender_keys) do
      add :sender_key_epoch, :integer, default: 0, null: false
    end

    create index(:group_sender_keys, [:chat_id, :owner_device_id, :sender_key_epoch],
             name: :group_sender_keys_chat_owner_epoch_index
           )
  end
end
