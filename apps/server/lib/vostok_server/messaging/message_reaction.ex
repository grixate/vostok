defmodule VostokServer.Messaging.MessageReaction do
  @moduledoc """
  Lightweight reaction marker attached to a message by a user.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "message_reactions" do
    field :reaction_key, :string

    belongs_to :message, VostokServer.Messaging.Message
    belongs_to :user, VostokServer.Identity.User

    timestamps(type: :utc_datetime_usec, updated_at: false)
  end

  def changeset(message_reaction, attrs) do
    message_reaction
    |> cast(attrs, [:message_id, :user_id, :reaction_key])
    |> validate_required([:message_id, :user_id, :reaction_key])
    |> validate_length(:reaction_key, min: 1, max: 24)
    |> unique_constraint(:reaction_key,
      name: :message_reactions_message_id_user_id_reaction_key_index
    )
  end
end
