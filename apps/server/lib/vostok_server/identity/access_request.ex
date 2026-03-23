defmodule VostokServer.Identity.AccessRequest do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "access_requests" do
    field :name, :string
    field :message, :string
    field :ip_address, :string
    field :ip_location, :string
    field :status, :string, default: "pending"

    belongs_to :reviewed_by_user, VostokServer.Identity.User, foreign_key: :reviewed_by
    belongs_to :invite, VostokServer.Identity.Invite

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(request, attrs) do
    request
    |> cast(attrs, [:name, :message, :ip_address, :ip_location, :status, :reviewed_by, :invite_id])
    |> validate_required([:name])
    |> validate_length(:name, max: 64)
    |> validate_length(:message, max: 500)
    |> validate_inclusion(:status, ~w(pending approved denied))
  end
end
