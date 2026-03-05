defmodule VostokServer.Repo.Migrations.AddFederationPeerTrustFields do
  use Ecto.Migration

  def change do
    alter table(:federation_peers) do
      add :invite_token_hash, :string
      add :trust_state, :string, null: false, default: "untrusted"
      add :trusted_at, :utc_datetime_usec
    end

    create index(:federation_peers, [:trust_state])
  end
end
