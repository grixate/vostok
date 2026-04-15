defmodule VostokServer.Messaging.MessageView do
  @moduledoc """
  Deduplicated per-user channel post views.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key false
  @foreign_key_type :binary_id

  schema "message_views" do
    field :viewed_at, :utc_datetime_usec

    belongs_to :message, VostokServer.Messaging.Message, primary_key: true
    belongs_to :user, VostokServer.Identity.User, primary_key: true
  end

  def changeset(message_view, attrs) do
    message_view
    |> cast(attrs, [:message_id, :user_id, :viewed_at])
    |> validate_required([:message_id, :user_id, :viewed_at])
    |> unique_constraint([:message_id, :user_id], name: :message_views_message_id_user_id_index)
  end
end
