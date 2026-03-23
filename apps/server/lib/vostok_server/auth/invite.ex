defmodule VostokServer.Auth.Invite do
  @moduledoc """
  Invite code generation, validation, and consumption.
  """

  import Ecto.Query

  alias VostokServer.Identity.Invite
  alias VostokServer.Repo

  @code_length 16
  @default_expiry_days 7

  @doc "Generate a new invite code."
  def create_invite(creator_user, opts \\ %{}) do
    code = generate_code()
    label = Map.get(opts, :label)

    expires_in_seconds =
      case Map.get(opts, :expires_in) do
        nil -> @default_expiry_days * 86_400
        :never -> nil
        seconds when is_integer(seconds) -> seconds
      end

    expires_at =
      if expires_in_seconds,
        do: DateTime.utc_now() |> DateTime.add(expires_in_seconds, :second),
        else: nil

    attrs = %{
      code: code,
      token_hash: hash_code(code),
      label: label,
      status: "pending",
      expires_at: expires_at
    }

    %Invite{}
    |> Invite.changeset(attrs)
    |> Ecto.Changeset.put_assoc(:creator_user, creator_user)
    |> Repo.insert()
    |> case do
      {:ok, invite} ->
        {:ok, %{invite: invite, code: code}}

      {:error, changeset} ->
        {:error, changeset}
    end
  end

  @doc "Validate an invite code without consuming it."
  def validate_code(code) when is_binary(code) do
    hash = hash_code(code)
    now = DateTime.utc_now()

    case Repo.one(from i in Invite, where: i.token_hash == ^hash, limit: 1) do
      nil ->
        {:error, "Invalid invite code."}

      %Invite{status: "pending"} = invite ->
        if invite.expires_at && DateTime.compare(invite.expires_at, now) == :lt do
          # Auto-expire
          invite |> Invite.changeset(%{status: "expired"}) |> Repo.update()
          {:error, "This invite has expired."}
        else
          {:ok, invite}
        end

      %Invite{status: "used"} ->
        {:error, "This invite has already been used."}

      %Invite{status: "expired"} ->
        {:error, "This invite has expired."}

      %Invite{status: "revoked"} ->
        {:error, "This invite has been revoked."}
    end
  end

  def validate_code(_), do: {:error, "Invalid invite code."}

  @doc "Consume an invite (mark as used by a user)."
  def consume_invite(code, user_id) when is_binary(code) do
    case validate_code(code) do
      {:ok, invite} ->
        invite
        |> Invite.changeset(%{
          status: "used",
          used_by: user_id,
          used_at: DateTime.utc_now()
        })
        |> Repo.update()

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc "List all invites."
  def list_invites do
    from(i in Invite, order_by: [desc: i.inserted_at], preload: [:creator_user, :used_by_user])
    |> Repo.all()
  end

  @doc "Revoke a pending invite."
  def revoke_invite(invite_id) do
    case Repo.get(Invite, invite_id) do
      %Invite{status: "pending"} = invite ->
        invite
        |> Invite.changeset(%{status: "revoked", revoked_at: DateTime.utc_now()})
        |> Repo.update()

      %Invite{} ->
        {:error, "Only pending invites can be revoked."}

      nil ->
        {:error, "Invite not found."}
    end
  end

  defp generate_code do
    :crypto.strong_rand_bytes(12)
    |> Base.encode64(padding: false)
    |> String.replace(~r/[^a-zA-Z0-9]/, "")
    |> binary_part(0, @code_length)
  end

  defp hash_code(code) do
    :crypto.hash(:sha256, code)
  end
end
