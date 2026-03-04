defmodule VostokServer.Messaging.ChatMember do
  @moduledoc """
  Membership record for a user within a chat.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "chat_members" do
    field :role, :string
    field :joined_at, :utc_datetime_usec

    belongs_to :chat, VostokServer.Messaging.Chat
    belongs_to :user, VostokServer.Identity.User

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(chat_member, attrs) do
    chat_member
    |> cast(attrs, [:role, :joined_at])
    |> validate_required([:role, :joined_at])
    |> validate_inclusion(:role, ["admin", "member"])
    |> unique_constraint(:user_id, name: :chat_members_chat_id_user_id_index)
  end
end
