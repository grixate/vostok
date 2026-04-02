defmodule VostokServer.Repo.Migrations.AddEndReasonToCallSessions do
  use Ecto.Migration

  def change do
    alter table(:call_sessions) do
      add :end_reason, :string
    end
  end
end
