defmodule VostokServer.Repo.Migrations.DropChatIsPublic do
  use Ecto.Migration

  # Channels are now always invite-only, identical to groups.
  # The public-channel directory concept was dropped — see the
  # groups & channels spec update.

  def up do
    alter table(:chats) do
      remove :is_public
    end
  end

  def down do
    alter table(:chats) do
      add :is_public, :boolean, default: false, null: false
    end
  end
end
