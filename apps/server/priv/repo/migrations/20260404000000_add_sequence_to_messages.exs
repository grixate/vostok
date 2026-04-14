defmodule VostokServer.Repo.Migrations.AddSequenceToMessages do
  use Ecto.Migration

  def change do
    # Per-chat monotonic sequence number for causal message ordering.
    # Guarantees total order within a chat even when timestamps collide.
    alter table(:messages) do
      add :seq, :bigint
    end

    # Create a sequence for generating per-chat sequence numbers atomically
    execute(
      "CREATE SEQUENCE IF NOT EXISTS messages_chat_seq",
      "DROP SEQUENCE IF EXISTS messages_chat_seq"
    )

    # Index for efficient ordering queries
    create index(:messages, [:chat_id, :seq], where: "seq IS NOT NULL")
  end
end
