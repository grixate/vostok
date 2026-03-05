defmodule VostokServer.Federation.Peer do
  @moduledoc """
  Configured remote peer for Stage 6 federation transport and trust management.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}

  schema "federation_peers" do
    field :domain, :string
    field :display_name, :string
    field :status, :string
    field :trust_state, :string
    field :invite_token_hash, :string
    field :trusted_at, :utc_datetime_usec
    field :last_error, :string
    field :last_seen_at, :utc_datetime_usec

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(peer, attrs) do
    peer
    |> cast(attrs, [
      :domain,
      :display_name,
      :status,
      :trust_state,
      :invite_token_hash,
      :trusted_at,
      :last_error,
      :last_seen_at
    ])
    |> validate_required([:domain, :status])
    |> validate_length(:domain, min: 3, max: 255)
    |> validate_inclusion(:status, ["pending", "active", "disabled"])
    |> validate_inclusion(:trust_state, ["untrusted", "invited", "trusted", "revoked"])
    |> unique_constraint(:domain)
  end
end
