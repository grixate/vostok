defmodule VostokServer.Calls.CallRoom do
  @moduledoc """
  Ephemeral room for ad-hoc multi-user calls that are not backed by a durable chat.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "call_rooms" do
    field :title, :string
    field :expires_at, :utc_datetime_usec
    field :closed_at, :utc_datetime_usec

    belongs_to :created_by_user, VostokServer.Identity.User
    has_many :members, VostokServer.Calls.CallRoomMember

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(call_room, attrs) do
    call_room
    |> cast(attrs, [:title, :created_by_user_id, :expires_at, :closed_at])
    |> validate_required([:title, :created_by_user_id, :expires_at])
    |> validate_length(:title, min: 1, max: 120)
  end
end
