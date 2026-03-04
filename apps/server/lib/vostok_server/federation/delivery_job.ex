defmodule VostokServer.Federation.DeliveryJob do
  @moduledoc """
  Durable outbound federation delivery queue entry.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias VostokServer.Federation.Peer

  @primary_key {:id, :binary_id, autogenerate: true}

  schema "federation_delivery_jobs" do
    field :direction, :string
    field :event_type, :string
    field :status, :string
    field :payload, :map
    field :attempt_count, :integer, default: 0
    field :available_at, :utc_datetime_usec
    field :last_attempted_at, :utc_datetime_usec
    field :delivered_at, :utc_datetime_usec
    field :last_error, :string

    belongs_to :peer, Peer, type: :binary_id

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(job, attrs) do
    job
    |> cast(attrs, [
      :peer_id,
      :direction,
      :event_type,
      :status,
      :payload,
      :attempt_count,
      :available_at,
      :last_attempted_at,
      :delivered_at,
      :last_error
    ])
    |> validate_required([:peer_id, :direction, :event_type, :status, :payload, :available_at])
    |> validate_inclusion(:direction, ["outbound"])
    |> validate_inclusion(:status, ["queued", "processing", "delivered", "failed"])
    |> validate_number(:attempt_count, greater_than_or_equal_to: 0)
    |> assoc_constraint(:peer)
  end
end
