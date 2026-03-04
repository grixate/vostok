defmodule VostokServer.Repo.Migrations.AddReplyToMessageIdToMessages do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :reply_to_message_id, references(:messages, type: :binary_id, on_delete: :nilify_all)
    end

    create index(:messages, [:reply_to_message_id])
  end
end
