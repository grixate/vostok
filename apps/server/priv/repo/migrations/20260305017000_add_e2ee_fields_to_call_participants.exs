defmodule VostokServer.Repo.Migrations.AddE2EEFieldsToCallParticipants do
  use Ecto.Migration

  def change do
    alter table(:call_participants) do
      add :e2ee_capable, :boolean, null: false, default: false
      add :e2ee_algorithm, :string
      add :e2ee_key_epoch, :integer
    end
  end
end
