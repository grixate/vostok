defmodule VostokServer.Calls.CallRoomMember do
  @moduledoc """
  Membership record for an ephemeral call room.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "call_room_members" do
    field :role, :string
    field :joined_at, :utc_datetime_usec
    field :left_at, :utc_datetime_usec

    belongs_to :room, VostokServer.Calls.CallRoom, foreign_key: :call_room_id
    belongs_to :user, VostokServer.Identity.User

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(member, attrs) do
    member
    |> cast(attrs, [:role, :joined_at, :left_at])
    |> validate_required([:role, :joined_at])
    |> validate_inclusion(:role, ["owner", "member"])
    |> unique_constraint(:user_id, name: :call_room_members_call_room_id_user_id_index)
  end
end
