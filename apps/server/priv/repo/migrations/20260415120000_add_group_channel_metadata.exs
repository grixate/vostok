defmodule VostokServer.Repo.Migrations.AddGroupChannelMetadata do
  use Ecto.Migration

  def up do
    alter table(:chats) do
      add :description, :text
      add :avatar_path, :string
      add :is_public, :boolean, default: false, null: false
      add :allow_comments, :boolean, default: true, null: false
      add :permissions_json, :map, default: %{}, null: false
    end

    execute("""
    WITH ranked AS (
      SELECT id
      FROM (
        SELECT cm.id,
               row_number() OVER (
                 PARTITION BY cm.chat_id
                 ORDER BY cm.joined_at ASC NULLS LAST, cm.inserted_at ASC, cm.id ASC
               ) AS rank
        FROM chat_members cm
        JOIN chats c ON c.id = cm.chat_id
        WHERE c.type IN ('group', 'channel') AND cm.role = 'admin'
      ) ranked_admins
      WHERE rank = 1
    )
    UPDATE chat_members
    SET role = 'owner'
    WHERE id IN (SELECT id FROM ranked)
    """)
  end

  def down do
    execute("""
    UPDATE chat_members
    SET role = 'admin'
    WHERE role = 'owner'
    """)

    alter table(:chats) do
      remove :permissions_json
      remove :allow_comments
      remove :is_public
      remove :avatar_path
      remove :description
    end
  end
end
