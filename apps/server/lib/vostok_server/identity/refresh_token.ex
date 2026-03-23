defmodule VostokServer.Identity.RefreshToken do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "refresh_tokens" do
    field :token_hash, :binary
    field :device_info, :string
    field :ip_address, :string
    field :expires_at, :utc_datetime_usec
    field :revoked_at, :utc_datetime_usec

    belongs_to :user, VostokServer.Identity.User

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(token, attrs) do
    token
    |> cast(attrs, [:token_hash, :device_info, :ip_address, :expires_at, :revoked_at])
    |> validate_required([:token_hash, :expires_at])
  end
end
