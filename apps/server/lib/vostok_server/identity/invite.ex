defmodule VostokServer.Identity.Invite do
  @moduledoc """
  Time-limited invite codes for controlled registration.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "invites" do
    field :token_hash, :binary
    field :code, :string
    field :label, :string
    field :status, :string, default: "pending"
    field :expires_at, :utc_datetime_usec
    field :used_at, :utc_datetime_usec
    field :revoked_at, :utc_datetime_usec

    belongs_to :creator_user, VostokServer.Identity.User
    belongs_to :used_by_user, VostokServer.Identity.User, foreign_key: :used_by

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(invite, attrs) do
    invite
    |> cast(attrs, [:token_hash, :code, :label, :status, :expires_at, :used_at, :used_by, :revoked_at])
    |> validate_required([:token_hash])
    |> validate_inclusion(:status, ~w(pending used expired revoked))
  end
end
