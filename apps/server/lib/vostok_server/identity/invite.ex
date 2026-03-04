defmodule VostokServer.Identity.Invite do
  @moduledoc """
  Time-limited invite links for invite-only instance registration.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "invites" do
    field :token_hash, :binary
    field :expires_at, :utc_datetime_usec
    field :used_at, :utc_datetime_usec

    belongs_to :creator_user, VostokServer.Identity.User

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(invite, attrs) do
    invite
    |> cast(attrs, [:token_hash, :expires_at, :used_at])
    |> validate_required([:token_hash, :expires_at])
  end
end
