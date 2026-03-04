defmodule VostokServer.Repo.Migrations.AddRemoteDeliveryIdToFederationDeliveryJobs do
  use Ecto.Migration

  def change do
    alter table(:federation_delivery_jobs) do
      add :remote_delivery_id, :string
    end

    create unique_index(
             :federation_delivery_jobs,
             [:peer_id, :direction, :remote_delivery_id],
             where: "remote_delivery_id IS NOT NULL",
             name: :federation_delivery_jobs_peer_direction_remote_delivery_id_index
           )
  end
end
