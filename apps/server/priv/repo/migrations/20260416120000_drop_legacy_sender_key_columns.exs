defmodule VostokServer.Repo.Migrations.DropLegacySenderKeyColumns do
  use Ecto.Migration

  # signal-v2 (PQXDH) uses per-device pairwise fanout; `sender_key_id` and
  # `sender_key_epoch` on the messages table were only ever written by the
  # legacy `group_sender_key_v1` transport. The Ecto schema already stopped
  # declaring these fields in Phase 3; this migration drops the dead
  # columns from the database.

  def up do
    alter table(:messages) do
      remove :sender_key_id
      remove :sender_key_epoch
    end
  end

  def down do
    alter table(:messages) do
      add :sender_key_id, :string
      add :sender_key_epoch, :integer
    end
  end
end
