defmodule VostokServer.Messaging.InviteLink do
  @moduledoc """
  Join link for a group or channel.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "invite_links" do
    field :code, :string
    field :expires_at, :utc_datetime_usec
    field :max_uses, :integer
    field :use_count, :integer, default: 0
    field :revoked_at, :utc_datetime_usec

    belongs_to :chat, VostokServer.Messaging.Chat
    belongs_to :created_by, VostokServer.Identity.User

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(invite_link, attrs) do
    invite_link
    |> cast(attrs, [:chat_id, :code, :created_by_id, :expires_at, :max_uses, :use_count, :revoked_at])
    |> validate_required([:chat_id, :code, :created_by_id])
    |> validate_number(:max_uses, greater_than: 0)
    |> validate_number(:use_count, greater_than_or_equal_to: 0)
    |> unique_constraint(:code)
  end
end
