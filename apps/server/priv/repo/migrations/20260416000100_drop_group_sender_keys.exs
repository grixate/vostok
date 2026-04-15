defmodule VostokServer.Repo.Migrations.DropGroupSenderKeys do
  use Ecto.Migration

  # libsignal v2 (PQXDH) uses per-device pairwise fanout for group messages,
  # not Signal sender keys. The sender-key subsystem was already kept only for
  # backwards compatibility — we drop it entirely in the signal-v2 cut.

  def up do
    drop_if_exists table(:group_sender_keys)
  end

  def down do
    # Recreating an exact mirror is out of scope — if you need to roll back,
    # restore from backup. The legacy sender-key flow is no longer part of
    # the server's wire contract.
    raise Ecto.MigrationError,
      message: "drop_group_sender_keys is irreversible: signal-v1/group_sender_key_v1 is gone."
  end
end
