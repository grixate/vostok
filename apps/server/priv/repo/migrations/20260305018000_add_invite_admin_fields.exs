defmodule VostokServer.Repo.Migrations.AddInviteAdminFields do
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :is_admin, :boolean, null: false, default: false
    end

    alter table(:invites) do
      add :label, :string
      add :revoked_at, :utc_datetime_usec
    end
  end
end
