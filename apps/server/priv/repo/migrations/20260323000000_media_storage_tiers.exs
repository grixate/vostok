defmodule VostokServer.Repo.Migrations.MediaStorageTiers do
  use Ecto.Migration

  def change do
    alter table(:media_uploads) do
      add :hot_cache_path, :string, size: 512
      add :storage_tier, :string, size: 20, default: "hot"
      add :media_status, :string, size: 20, default: "available"
      add :evicted_at, :utc_datetime_usec
      add :last_accessed_at, :utc_datetime_usec, default: fragment("NOW()")
      add :recipient_count, :integer, default: 0
      add :confirmed_count, :integer, default: 0
      add :fully_delivered, :boolean, default: false
      add :fully_delivered_at, :utc_datetime_usec
    end

    create index(:media_uploads, [:storage_tier, :fully_delivered, :inserted_at],
      where: "media_status = 'available'",
      name: :idx_media_uploads_eviction
    )
  end
end
