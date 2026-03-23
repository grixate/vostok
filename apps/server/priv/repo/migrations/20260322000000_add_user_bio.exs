defmodule VostokServer.Repo.Migrations.AddUserBio do
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :bio, :string, size: 256
    end
  end
end
