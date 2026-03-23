defmodule VostokServer.Repo.Migrations.AddObjectKeyToMediaUploads do
  use Ecto.Migration

  def change do
    alter table(:media_uploads) do
      add :object_key, :string, size: 512
    end
  end
end
