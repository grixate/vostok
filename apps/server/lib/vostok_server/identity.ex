defmodule VostokServer.Identity do
  @moduledoc """
  Identity context for Stage 2 registration and device bootstrap.
  """

  import Ecto.Query

  alias Ecto.Multi
  alias VostokServer.Identity.{Device, Invite, OneTimePrekey, User}
  alias VostokServer.Repo

  @type register_result ::
          {:ok, %{user: User.t(), device: Device.t(), one_time_prekeys: [OneTimePrekey.t()]}}
          | {:error, term()}
  @type link_result ::
          {:ok, %{user: User.t(), device: Device.t(), one_time_prekeys: [OneTimePrekey.t()]}}
          | {:error, term()}

  def register_device(attrs) when is_map(attrs) do
    with {:ok, normalized} <- normalize_registration(attrs),
         :ok <-
           validate_signed_prekey_material(
             normalized.device_identity_public_key,
             normalized.signed_prekey,
             normalized.signed_prekey_signature
           ) do
      now = DateTime.utc_now()

      Multi.new()
      |> Multi.run(:invite, fn repo, _changes -> validate_invite(repo, normalized, now) end)
      |> Multi.insert(:user, User.changeset(%User{}, user_attrs(normalized)))
      |> Multi.run(:device, fn repo, %{user: user} ->
        user
        |> Ecto.build_assoc(:devices)
        |> Device.changeset(device_attrs(normalized, now))
        |> repo.insert()
      end)
      |> Multi.run(:one_time_prekeys, fn repo, %{device: device} ->
        insert_one_time_prekeys(repo, device, normalized.one_time_prekeys)
      end)
      |> Multi.run(:consume_invite, fn repo, %{invite: invite} ->
        consume_invite(repo, invite, now)
      end)
      |> Repo.transaction()
      |> case do
        {:ok, %{user: user, device: device, one_time_prekeys: one_time_prekeys}} ->
          {:ok, %{user: user, device: device, one_time_prekeys: one_time_prekeys}}

        {:error, _step, reason, _changes} ->
          {:error, reason}
      end
    end
  end

  def link_device(user_id, attrs) when is_binary(user_id) and is_map(attrs) do
    with %User{} = user <- Repo.get(User, user_id),
         {:ok, normalized} <- normalize_linked_device(attrs),
         :ok <-
           validate_signed_prekey_material(
             normalized.device_identity_public_key,
             normalized.signed_prekey,
             normalized.signed_prekey_signature
           ),
         :ok <-
           ensure_device_identity_not_registered(user.id, normalized.device_identity_public_key) do
      now = DateTime.utc_now()

      Multi.new()
      |> Multi.run(:device, fn repo, _changes ->
        user
        |> Ecto.build_assoc(:devices)
        |> Device.changeset(device_attrs(normalized, now))
        |> repo.insert()
      end)
      |> Multi.run(:one_time_prekeys, fn repo, %{device: device} ->
        insert_one_time_prekeys(repo, device, normalized.one_time_prekeys)
      end)
      |> Repo.transaction()
      |> case do
        {:ok, %{device: device, one_time_prekeys: one_time_prekeys}} ->
          {:ok, %{user: user, device: device, one_time_prekeys: one_time_prekeys}}

        {:error, _step, reason, _changes} ->
          {:error, reason}
      end
    else
      nil ->
        {:error, {:not_found, "User not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def get_device(device_id) when is_binary(device_id) do
    Repo.get(Device, device_id)
  end

  def publish_device_prekeys(device_id, attrs) when is_binary(device_id) and is_map(attrs) do
    with %Device{revoked_at: nil} = device <- Repo.get(Device, device_id),
         {:ok, normalized} <- normalize_prekey_publication(attrs),
         :ok <-
           validate_signed_prekey_material(
             device.identity_public_key,
             normalized.signed_prekey,
             normalized.signed_prekey_signature
           ) do
      Repo.transaction(fn ->
        updated_device =
          maybe_update_signed_prekey(
            device,
            normalized.signed_prekey,
            normalized.signed_prekey_signature
          )

        if normalized.replace_one_time_prekeys do
          Repo.delete_all(from(prekey in OneTimePrekey, where: prekey.device_id == ^device.id))
        end

        case insert_one_time_prekeys(Repo, device, normalized.one_time_prekeys) do
          {:ok, _inserted} ->
            :ok

          {:error, reason} ->
            Repo.rollback(reason)
        end

        %{
          device_id: updated_device.id,
          has_signed_prekey: not is_nil(updated_device.signed_prekey),
          one_time_prekey_count: active_prekey_count(device.id)
        }
      end)
    else
      nil ->
        {:error, {:not_found, "Device not found."}}

      %Device{} ->
        {:error, {:unauthorized, "This device has been revoked."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def fetch_user_prekey_bundles(username) when is_binary(username) do
    case Repo.get_by(User, username: String.trim(username)) do
      %User{} = user ->
        Repo.transaction(fn ->
          active_devices_for_prekeys(user.id)
          |> Enum.map(&build_prekey_bundle/1)
        end)

      nil ->
        {:error, {:not_found, "User not found."}}
    end
  end

  defp normalize_registration(attrs) do
    with {:ok, username} <- fetch_trimmed(attrs, "username"),
         {:ok, device_name} <- fetch_trimmed(attrs, "device_name"),
         {:ok, device_identity_public_key} <-
           decode_required_base64(attrs, "device_identity_public_key"),
         {:ok, device_encryption_public_key} <-
           decode_optional_base64(attrs, "device_encryption_public_key"),
         {:ok, user_identity_public_key} <-
           decode_optional_base64(attrs, "user_identity_public_key", device_identity_public_key),
         {:ok, signed_prekey} <- decode_optional_base64(attrs, "signed_prekey"),
         {:ok, signed_prekey_signature} <-
           decode_optional_base64(attrs, "signed_prekey_signature"),
         {:ok, settings_encrypted} <- decode_optional_base64(attrs, "settings_encrypted"),
         {:ok, one_time_prekeys} <- decode_prekeys(Map.get(attrs, "one_time_prekeys", [])) do
      {:ok,
       %{
         username: username,
         device_name: device_name,
         device_identity_public_key: device_identity_public_key,
         device_encryption_public_key: device_encryption_public_key,
         user_identity_public_key: user_identity_public_key,
         signed_prekey: signed_prekey,
         signed_prekey_signature: signed_prekey_signature,
         settings_encrypted: settings_encrypted,
         one_time_prekeys: one_time_prekeys,
         invite_token: blank_to_nil(Map.get(attrs, "invite_token"))
       }}
    end
  end

  defp normalize_linked_device(attrs) do
    with {:ok, device_name} <- fetch_trimmed(attrs, "device_name"),
         {:ok, device_identity_public_key} <-
           decode_required_base64(attrs, "device_identity_public_key"),
         {:ok, device_encryption_public_key} <-
           decode_required_base64(attrs, "device_encryption_public_key"),
         {:ok, signed_prekey} <- decode_required_base64(attrs, "signed_prekey"),
         {:ok, signed_prekey_signature} <-
           decode_required_base64(attrs, "signed_prekey_signature"),
         {:ok, one_time_prekeys} <- decode_prekeys(Map.get(attrs, "one_time_prekeys", [])),
         :ok <- ensure_non_empty_prekeys(one_time_prekeys) do
      {:ok,
       %{
         device_name: device_name,
         device_identity_public_key: device_identity_public_key,
         device_encryption_public_key: device_encryption_public_key,
         signed_prekey: signed_prekey,
         signed_prekey_signature: signed_prekey_signature,
         one_time_prekeys: one_time_prekeys
       }}
    end
  end

  defp validate_invite(repo, %{invite_token: invite_token}, now) do
    registration_mode = Application.get_env(:vostok_server, :registration_mode, "open")

    cond do
      registration_mode == "closed" ->
        {:error, {:registration_closed, "Registration is closed on this instance."}}

      invite_token == nil and registration_mode == "invite_only" ->
        {:error, {:invite_required, "An invite token is required on this instance."}}

      invite_token == nil ->
        {:ok, :skip}

      true ->
        token_hash = :crypto.hash(:sha256, invite_token)

        invite =
          from(invite in Invite,
            where:
              invite.token_hash == ^token_hash and is_nil(invite.used_at) and
                invite.expires_at > ^now
          )
          |> repo.one()

        case invite do
          %Invite{} = valid_invite -> {:ok, valid_invite}
          nil -> {:error, {:invalid_invite, "The invite token is invalid or expired."}}
        end
    end
  end

  defp consume_invite(_repo, :skip, _now), do: {:ok, :skip}

  defp consume_invite(repo, %Invite{} = invite, now) do
    invite
    |> Invite.changeset(%{used_at: now})
    |> repo.update()
    |> case do
      {:ok, updated_invite} -> {:ok, updated_invite}
      {:error, changeset} -> {:error, changeset}
    end
  end

  defp insert_one_time_prekeys(_repo, _device, []), do: {:ok, []}

  defp insert_one_time_prekeys(repo, %Device{} = device, prekeys) do
    Enum.reduce_while(prekeys, {:ok, []}, fn public_key, {:ok, inserted} ->
      device
      |> Ecto.build_assoc(:one_time_prekeys)
      |> OneTimePrekey.changeset(%{public_key: public_key})
      |> repo.insert()
      |> case do
        {:ok, prekey} -> {:cont, {:ok, [prekey | inserted]}}
        {:error, changeset} -> {:halt, {:error, changeset}}
      end
    end)
    |> case do
      {:ok, inserted} -> {:ok, Enum.reverse(inserted)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp user_attrs(normalized) do
    %{
      username: normalized.username,
      identity_public_key: normalized.user_identity_public_key,
      settings_encrypted: normalized.settings_encrypted
    }
  end

  defp device_attrs(normalized, now) do
    %{
      device_name: normalized.device_name,
      identity_public_key: normalized.device_identity_public_key,
      encryption_public_key: normalized.device_encryption_public_key,
      signed_prekey: normalized.signed_prekey,
      signed_prekey_signature: normalized.signed_prekey_signature,
      last_active_at: now
    }
  end

  defp fetch_trimmed(attrs, key) do
    case attrs |> Map.get(key) |> blank_to_nil() do
      nil -> {:error, {:validation, key, "#{humanize(key)} is required."}}
      value -> {:ok, value}
    end
  end

  defp decode_required_base64(attrs, key) do
    case attrs |> Map.get(key) |> blank_to_nil() do
      nil -> {:error, {:validation, key, "#{humanize(key)} is required."}}
      value -> decode_base64(value, key)
    end
  end

  defp decode_optional_base64(attrs, key, default \\ nil) do
    case attrs |> Map.get(key) |> blank_to_nil() do
      nil -> {:ok, default}
      value -> decode_base64(value, key)
    end
  end

  defp decode_prekeys(prekeys) when is_list(prekeys) do
    Enum.reduce_while(prekeys, {:ok, []}, fn entry, {:ok, decoded} ->
      case decode_base64(entry, "one_time_prekeys") do
        {:ok, public_key} -> {:cont, {:ok, [public_key | decoded]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, decoded} -> {:ok, Enum.reverse(decoded)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp decode_prekeys(_),
    do: {:error, {:validation, "one_time_prekeys", "One-time prekeys must be a list."}}

  defp decode_base64(value, key) when is_binary(value) do
    case Base.decode64(value) do
      {:ok, decoded} -> {:ok, decoded}
      :error -> {:error, {:validation, key, "#{humanize(key)} must be valid base64."}}
    end
  end

  defp decode_base64(_, key),
    do: {:error, {:validation, key, "#{humanize(key)} must be a string."}}

  defp normalize_prekey_publication(attrs) do
    with {:ok, signed_prekey} <- decode_optional_base64(attrs, "signed_prekey"),
         {:ok, signed_prekey_signature} <-
           decode_optional_base64(attrs, "signed_prekey_signature"),
         {:ok, one_time_prekeys} <- decode_prekeys(Map.get(attrs, "one_time_prekeys", [])),
         {:ok, replace_one_time_prekeys} <-
           parse_boolean(Map.get(attrs, "replace_one_time_prekeys", false)) do
      {:ok,
       %{
         signed_prekey: signed_prekey,
         signed_prekey_signature: signed_prekey_signature,
         one_time_prekeys: one_time_prekeys,
         replace_one_time_prekeys: replace_one_time_prekeys
       }}
    end
  end

  defp parse_boolean(value) when is_boolean(value), do: {:ok, value}
  defp parse_boolean(nil), do: {:ok, false}

  defp parse_boolean(_),
    do:
      {:error,
       {:validation, "replace_one_time_prekeys", "replace_one_time_prekeys must be a boolean."}}

  defp ensure_non_empty_prekeys([]) do
    {:error, {:validation, "one_time_prekeys", "At least one one-time prekey is required."}}
  end

  defp ensure_non_empty_prekeys(_one_time_prekeys), do: :ok

  defp ensure_device_identity_not_registered(user_id, identity_public_key) do
    existing_device =
      from(device in Device,
        where:
          device.user_id == ^user_id and device.identity_public_key == ^identity_public_key and
            is_nil(device.revoked_at),
        limit: 1
      )
      |> Repo.one()

    if existing_device do
      {:error,
       {:validation, "device_identity_public_key", "This device identity is already linked."}}
    else
      :ok
    end
  end

  defp maybe_update_signed_prekey(device, nil, nil), do: device

  defp maybe_update_signed_prekey(%Device{} = device, signed_prekey, signed_prekey_signature) do
    device
    |> Device.changeset(%{
      signed_prekey: signed_prekey,
      signed_prekey_signature: signed_prekey_signature
    })
    |> Repo.update!()
  end

  defp active_prekey_count(device_id) do
    from(prekey in OneTimePrekey,
      where: prekey.device_id == ^device_id and is_nil(prekey.used_at),
      select: count(prekey.id)
    )
    |> Repo.one()
  end

  defp active_devices_for_prekeys(user_id) do
    from(device in Device,
      where:
        device.user_id == ^user_id and is_nil(device.revoked_at) and
          not is_nil(device.identity_public_key) and not is_nil(device.encryption_public_key) and
          not is_nil(device.signed_prekey) and not is_nil(device.signed_prekey_signature),
      order_by: [asc: device.inserted_at]
    )
    |> Repo.all()
  end

  defp build_prekey_bundle(%Device{} = device) do
    one_time_prekey = peek_one_time_prekey(device.id)

    %{
      device_id: device.id,
      user_id: device.user_id,
      device_name: device.device_name,
      identity_public_key: Base.encode64(device.identity_public_key),
      encryption_public_key: encode_optional_binary(device.encryption_public_key),
      signed_prekey: encode_optional_binary(device.signed_prekey),
      signed_prekey_signature: encode_optional_binary(device.signed_prekey_signature),
      one_time_prekey: one_time_prekey && Base.encode64(one_time_prekey.public_key)
    }
  end

  defp peek_one_time_prekey(device_id) do
    Repo.one(
      from(prekey in OneTimePrekey,
        where: prekey.device_id == ^device_id and is_nil(prekey.used_at),
        order_by: [asc: prekey.inserted_at],
        limit: 1
      )
    )
  end

  defp encode_optional_binary(nil), do: nil
  defp encode_optional_binary(value), do: Base.encode64(value)

  defp validate_signed_prekey_material(_identity_public_key, nil, nil), do: :ok

  defp validate_signed_prekey_material(_identity_public_key, nil, _signed_prekey_signature) do
    {:error,
     {:validation, "signed_prekey_signature", "signed_prekey_signature requires a signed_prekey."}}
  end

  defp validate_signed_prekey_material(_identity_public_key, _signed_prekey, nil) do
    {:error, {:validation, "signed_prekey_signature", "signed_prekey_signature is required."}}
  end

  defp validate_signed_prekey_material(
         identity_public_key,
         signed_prekey,
         signed_prekey_signature
       ) do
    if verify_signed_prekey_signature(identity_public_key, signed_prekey, signed_prekey_signature) do
      :ok
    else
      {:error,
       {:validation, "signed_prekey_signature", "signed_prekey_signature verification failed."}}
    end
  end

  defp verify_signed_prekey_signature(identity_public_key, signed_prekey, signed_prekey_signature) do
    :crypto.verify(:eddsa, :none, signed_prekey, signed_prekey_signature, [
      identity_public_key,
      :ed25519
    ])
  rescue
    _ -> false
  end

  defp blank_to_nil(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp blank_to_nil(value), do: value

  defp humanize(key) do
    key
    |> String.replace("_", " ")
    |> String.capitalize()
  end
end
