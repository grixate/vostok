defmodule VostokServer.Media.Delivery do
  @moduledoc "Tracks which users have confirmed downloading a media item."

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key false

  schema "media_deliveries" do
    field :media_id, :binary_id
    field :user_id, :binary_id
    field :confirmed_at, :utc_datetime_usec
  end

  def changeset(delivery, attrs) do
    delivery
    |> cast(attrs, [:media_id, :user_id, :confirmed_at])
    |> validate_required([:media_id, :user_id])
    |> unique_constraint([:media_id, :user_id])
  end
end
