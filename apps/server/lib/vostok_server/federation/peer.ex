defmodule VostokServer.Federation.Peer do
  @moduledoc """
  Configured remote peer scaffold for Stage 6 federation administration.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}

  schema "federation_peers" do
    field :domain, :string
    field :display_name, :string
    field :status, :string
    field :last_error, :string
    field :last_seen_at, :utc_datetime_usec

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(peer, attrs) do
    peer
    |> cast(attrs, [:domain, :display_name, :status, :last_error, :last_seen_at])
    |> validate_required([:domain, :status])
    |> validate_length(:domain, min: 3, max: 255)
    |> validate_inclusion(:status, ["pending", "active", "disabled"])
    |> unique_constraint(:domain)
  end
end
