defmodule VostokServer.Repo.Migrations.AddProfilePhotoToUsers do
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :profile_photo_path, :string, size: 512
      add :profile_photo_content_type, :string, size: 127
    end
  end
end
