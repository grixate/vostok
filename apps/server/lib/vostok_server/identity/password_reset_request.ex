defmodule VostokServer.Identity.PasswordResetRequest do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "password_reset_requests" do
    field :message, :string
    field :status, :string, default: "pending"

    belongs_to :user, VostokServer.Identity.User
    belongs_to :reviewed_by_user, VostokServer.Identity.User, foreign_key: :reviewed_by

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(request, attrs) do
    request
    |> cast(attrs, [:message, :status, :user_id, :reviewed_by])
    |> validate_required([:user_id])
    |> validate_length(:message, max: 500)
    |> validate_inclusion(:status, ~w(pending approved denied))
  end
end
