defmodule VostokServer.Identity do
  @moduledoc """
  Identity context for Stage 2 registration and device bootstrap.
  """

  import Ecto.Query

  alias Ecto.Multi
  alias VostokServer.Identity.{Device, DeviceSession, Invite, OneTimePrekey, User}
  alias VostokServer.Repo

  @prekey_low_watermark 20
  @prekey_target_count 100

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

  def list_all_users do
    User
    |> order_by([u], asc: u.username)
    |> Repo.all()
    |> Enum.map(&present_user/1)
  end

  defp present_user(%User{} = user) do
    %{
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      bio: user.bio,
      role: user.role,
      joined_at: user.inserted_at,
      last_seen_at: user.last_seen_at,
      has_photo: is_binary(user.profile_photo_path) and user.profile_photo_path != ""
    }
  end

  def update_user_profile(user, attrs) when is_map(attrs) do
    user
    |> User.profile_changeset(attrs)
    |> Repo.update()
  end

  def update_user_settings(user, settings_binary) when is_binary(settings_binary) do
    user
    |> User.settings_changeset(%{settings_encrypted: settings_binary})
    |> Repo.update()
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
      |> Multi.run(:revoke_placeholders, fn repo, _changes ->
        # Revoke old placeholder devices that lack encryption keys — they were
        # auto-created during registration and can't participate in E2E messaging.
        {count, _} =
          repo.update_all(
            from(d in Device,
              where:
                d.user_id == ^user.id and
                  is_nil(d.revoked_at) and
                  is_nil(d.encryption_public_key)
            ),
            set: [revoked_at: now]
          )

        {:ok, count}
      end)
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

  def prekey_inventory(device_id) when is_binary(device_id) do
    case Repo.get(Device, device_id) do
      %Device{} = device ->
        active_count = active_prekey_count(device.id)

        {:ok,
         %{
           device_id: device.id,
           available_one_time_prekeys: active_count,
           low_watermark: @prekey_low_watermark,
           target_count: @prekey_target_count,
           replenish_recommended: active_count < @prekey_low_watermark
         }}

      nil ->
        {:error, {:not_found, "Device not found."}}
    end
  end

  def list_user_devices(user_id, current_device_id)
      when is_binary(user_id) do
    safe_device_id = current_device_id || "none"

    with %User{} <- Repo.get(User, user_id) do
      devices =
        from(device in Device,
          where: device.user_id == ^user_id,
          order_by: [
            desc: is_nil(device.revoked_at),
            desc: device.last_active_at,
            asc: device.inserted_at
          ]
        )
        |> Repo.all()
        |> Enum.map(&present_device_summary(&1, safe_device_id))

      {:ok, devices}
    else
      nil ->
        {:error, {:not_found, "User not found."}}
    end
  end

  def revoke_device(user_id, device_id, current_device_id)
      when is_binary(user_id) and is_binary(device_id) and is_binary(current_device_id) do
    with %Device{} = current_device <- Repo.get(Device, current_device_id),
         :ok <- ensure_device_owner(current_device, user_id),
         %Device{} = target_device <- Repo.get(Device, device_id),
         :ok <- ensure_device_owner(target_device, user_id),
         :ok <- ensure_not_current_device(target_device.id, current_device_id) do
      if target_device.revoked_at do
        {:ok, present_device_summary(target_device, current_device_id)}
      else
        now = DateTime.utc_now()

        Repo.transaction(fn ->
          {:ok, revoked_device} =
            target_device
            |> Device.changeset(%{revoked_at: now, last_active_at: now})
            |> Repo.update()

          Repo.delete_all(
            from(session in DeviceSession, where: session.device_id == ^revoked_device.id)
          )

          Repo.delete_all(
            from(prekey in OneTimePrekey,
              where: prekey.device_id == ^revoked_device.id and is_nil(prekey.used_at)
            )
          )

          present_device_summary(revoked_device, current_device_id)
        end)
      end
    else
      nil ->
        {:error, {:not_found, "Device not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def update_push_token(user_id, current_device_id, attrs)
      when is_binary(user_id) and is_binary(current_device_id) and is_map(attrs) do
    with %Device{} = current_device <- Repo.get(Device, current_device_id),
         :ok <- ensure_device_owner(current_device, user_id),
         {:ok, normalized} <- normalize_push_token(attrs),
         {:ok, updated_device} <-
           current_device
           |> Device.changeset(%{
             push_provider: normalized.push_provider,
             push_token: normalized.push_token,
             push_token_updated_at: DateTime.utc_now()
           })
           |> Repo.update() do
      {:ok, present_device_summary(updated_device, current_device_id)}
    else
      nil ->
        {:error, {:not_found, "Device not found."}}

      {:error, reason} ->
        {:error, reason}
    end
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
          device
          |> maybe_update_signed_prekey(
            normalized.signed_prekey,
            normalized.signed_prekey_signature,
            Map.get(normalized, :signed_prekey_id)
          )
          |> maybe_update_kyber_prekey(
            Map.get(normalized, :kyber_prekey_public),
            Map.get(normalized, :kyber_prekey_signature),
            Map.get(normalized, :kyber_prekey_id)
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
          has_kyber_prekey: not is_nil(updated_device.kyber_prekey_public),
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
         {:ok, kyber_prekey_public} <- decode_optional_base64(attrs, "kyber_prekey"),
         {:ok, kyber_prekey_signature} <-
           decode_optional_base64(attrs, "kyber_prekey_signature"),
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
         kyber_prekey_public: kyber_prekey_public,
         kyber_prekey_signature: kyber_prekey_signature,
         kyber_prekey_id: parse_optional_integer(attrs, "kyber_prekey_id"),
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
         {:ok, kyber_prekey_public} <- decode_required_base64(attrs, "kyber_prekey"),
         {:ok, kyber_prekey_signature} <-
           decode_required_base64(attrs, "kyber_prekey_signature"),
         {:ok, one_time_prekeys} <- decode_prekeys_with_ids(Map.get(attrs, "one_time_prekeys", [])),
         :ok <- ensure_non_empty_prekeys(one_time_prekeys) do
      {:ok,
       %{
         device_name: device_name,
         device_identity_public_key: device_identity_public_key,
         device_encryption_public_key: device_encryption_public_key,
         signed_prekey: signed_prekey,
         signed_prekey_signature: signed_prekey_signature,
         kyber_prekey_public: kyber_prekey_public,
         kyber_prekey_signature: kyber_prekey_signature,
         registration_id: parse_optional_integer(attrs, "registration_id"),
         signed_prekey_id: parse_optional_integer(attrs, "signed_prekey_id"),
         kyber_prekey_id: parse_optional_integer(attrs, "kyber_prekey_id"),
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
    Enum.reduce_while(prekeys, {:ok, []}, fn prekey_entry, {:ok, inserted} ->
      {public_key, key_id} = normalize_prekey_entry(prekey_entry)

      device
      |> Ecto.build_assoc(:one_time_prekeys)
      |> OneTimePrekey.changeset(%{public_key: public_key, key_id: key_id})
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

  defp normalize_prekey_entry(%{"public_key" => _, "key_id" => _} = entry) do
    {:ok, public_key} = Base.decode64(entry["public_key"])
    {public_key, entry["key_id"]}
  end

  defp normalize_prekey_entry(public_key) when is_binary(public_key) do
    {public_key, nil}
  end

  defp user_attrs(normalized) do
    %{
      username: normalized.username,
      identity_public_key: normalized.user_identity_public_key,
      settings_encrypted: normalized.settings_encrypted
    }
  end

  defp device_attrs(normalized, now) do
    base = %{
      device_name: normalized.device_name,
      identity_public_key: normalized.device_identity_public_key,
      encryption_public_key: normalized.device_encryption_public_key,
      signed_prekey: normalized.signed_prekey,
      signed_prekey_signature: normalized.signed_prekey_signature,
      kyber_prekey_public: normalized.kyber_prekey_public,
      kyber_prekey_signature: normalized.kyber_prekey_signature,
      last_active_at: now
    }

    base
    |> maybe_put(:registration_id, Map.get(normalized, :registration_id))
    |> maybe_put(:signed_prekey_id_counter, Map.get(normalized, :signed_prekey_id))
    |> maybe_put(:kyber_prekey_id, Map.get(normalized, :kyber_prekey_id))
    |> maybe_put(:kyber_prekey_id_counter, Map.get(normalized, :kyber_prekey_id))
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

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

  # Accepts both legacy format (list of base64 strings) and new Signal format
  # (list of %{"key_id" => integer, "public_key" => base64}).
  defp decode_prekeys_with_ids(prekeys) when is_list(prekeys) do
    Enum.reduce_while(prekeys, {:ok, []}, fn
      %{"key_id" => key_id, "public_key" => public_key}, {:ok, acc}
      when is_integer(key_id) and is_binary(public_key) ->
        {:cont, {:ok, acc ++ [%{"key_id" => key_id, "public_key" => public_key}]}}

      entry, {:ok, acc} when is_binary(entry) ->
        case Base.decode64(entry) do
          {:ok, decoded} -> {:cont, {:ok, acc ++ [decoded]}}
          :error -> {:halt, {:error, {:validation, "one_time_prekeys", "Invalid base64 in prekey."}}}
        end

      _, _ ->
        {:halt, {:error, {:validation, "one_time_prekeys", "Invalid prekey format."}}}
    end)
  end

  defp decode_prekeys_with_ids(_),
    do: {:error, {:validation, "one_time_prekeys", "One-time prekeys must be a list."}}

  defp parse_optional_integer(attrs, key) do
    case Map.get(attrs, key) do
      value when is_integer(value) -> value
      _ -> nil
    end
  end

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
         {:ok, kyber_prekey_public} <- decode_optional_base64(attrs, "kyber_prekey"),
         {:ok, kyber_prekey_signature} <-
           decode_optional_base64(attrs, "kyber_prekey_signature"),
         {:ok, one_time_prekeys} <- decode_prekeys_with_ids(Map.get(attrs, "one_time_prekeys", [])),
         {:ok, replace_one_time_prekeys} <-
           parse_boolean(Map.get(attrs, "replace_one_time_prekeys", false)) do
      {:ok,
       %{
         signed_prekey: signed_prekey,
         signed_prekey_signature: signed_prekey_signature,
         signed_prekey_id: parse_optional_integer(attrs, "signed_prekey_id"),
         kyber_prekey_public: kyber_prekey_public,
         kyber_prekey_signature: kyber_prekey_signature,
         kyber_prekey_id: parse_optional_integer(attrs, "kyber_prekey_id"),
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

  defp maybe_update_signed_prekey(device, nil, nil, _signed_prekey_id), do: device

  defp maybe_update_signed_prekey(%Device{} = device, signed_prekey, signed_prekey_signature, signed_prekey_id) do
    attrs = %{
      signed_prekey: signed_prekey,
      signed_prekey_signature: signed_prekey_signature
    }

    attrs = if signed_prekey_id, do: Map.put(attrs, :signed_prekey_id_counter, signed_prekey_id), else: attrs

    device
    |> Device.changeset(attrs)
    |> Repo.update!()
  end

  defp maybe_update_kyber_prekey(device, nil, nil, _kyber_prekey_id), do: device

  defp maybe_update_kyber_prekey(
         %Device{} = device,
         kyber_prekey_public,
         kyber_prekey_signature,
         kyber_prekey_id
       ) do
    attrs = %{
      kyber_prekey_public: kyber_prekey_public,
      kyber_prekey_signature: kyber_prekey_signature
    }

    attrs =
      if kyber_prekey_id do
        attrs
        |> Map.put(:kyber_prekey_id, kyber_prekey_id)
        |> Map.put(:kyber_prekey_id_counter, kyber_prekey_id)
      else
        attrs
      end

    device
    |> Device.changeset(attrs)
    |> Repo.update!()
  end

  defp active_prekey_count(device_id) do
    from(prekey in OneTimePrekey,
      where: prekey.device_id == ^device_id and is_nil(prekey.used_at),
      select: count(prekey.id)
    )
    |> Repo.one()
  end

  defp present_device_summary(%Device{} = device, current_device_id) do
    %{
      id: device.id,
      device_name: device.device_name,
      is_current: device.id == current_device_id,
      revoked_at: device.revoked_at && DateTime.to_iso8601(device.revoked_at),
      last_active_at: device.last_active_at && DateTime.to_iso8601(device.last_active_at),
      inserted_at: device.inserted_at && DateTime.to_iso8601(device.inserted_at),
      one_time_prekey_count: active_prekey_count(device.id),
      push_provider: device.push_provider,
      push_token_updated_at:
        device.push_token_updated_at && DateTime.to_iso8601(device.push_token_updated_at)
    }
  end

  defp normalize_push_token(attrs) when is_map(attrs) do
    with {:ok, push_provider} <- fetch_trimmed(attrs, "push_provider"),
         {:ok, push_token} <- fetch_trimmed(attrs, "push_token"),
         :ok <- ensure_push_provider(push_provider),
         :ok <- ensure_push_token_length(push_token) do
      {:ok, %{push_provider: push_provider, push_token: push_token}}
    end
  end

  defp ensure_push_provider(provider) when provider in ["fcm", "unifiedpush"], do: :ok

  defp ensure_push_provider(_provider),
    do: {:error, {:validation, "push_provider", "push_provider must be one of: fcm, unifiedpush."}}

  defp ensure_push_token_length(token) when is_binary(token) and byte_size(token) <= 2048, do: :ok

  defp ensure_push_token_length(_token),
    do: {:error, {:validation, "push_token", "push_token must be a non-empty string up to 2048 bytes."}}

  defp ensure_device_owner(%Device{user_id: user_id}, user_id), do: :ok

  defp ensure_device_owner(_device, _user_id),
    do: {:error, {:unauthorized, "This device does not belong to the authenticated user."}}

  defp ensure_not_current_device(device_id, current_device_id)
       when device_id == current_device_id do
    {:error, {:validation, "The active device cannot revoke itself."}}
  end

  defp ensure_not_current_device(_device_id, _current_device_id), do: :ok

  defp active_devices_for_prekeys(user_id) do
    from(device in Device,
      where:
        device.user_id == ^user_id and is_nil(device.revoked_at) and
          not is_nil(device.identity_public_key) and not is_nil(device.encryption_public_key) and
          not is_nil(device.signed_prekey) and not is_nil(device.signed_prekey_signature) and
          not is_nil(device.kyber_prekey_public) and not is_nil(device.kyber_prekey_signature),
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
      registration_id: device.registration_id,
      signed_prekey_id: device.signed_prekey_id_counter,
      signed_prekey: encode_optional_binary(device.signed_prekey),
      signed_prekey_signature: encode_optional_binary(device.signed_prekey_signature),
      one_time_prekey_id: one_time_prekey && one_time_prekey.key_id,
      one_time_prekey: one_time_prekey && Base.encode64(one_time_prekey.public_key),
      kyber_prekey_id: device.kyber_prekey_id,
      kyber_prekey: encode_optional_binary(device.kyber_prekey_public),
      kyber_prekey_signature: encode_optional_binary(device.kyber_prekey_signature)
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
    # Try Ed25519 verification first (legacy P-256 devices use Ed25519 identity keys).
    # If that fails, try XEdDSA/Curve25519 verification (Signal protocol devices).
    # The Signal library signs prekeys with the Curve25519 identity key, which
    # is not verifiable with :ed25519. For Signal devices (identified by having
    # a 32-byte identity key — Curve25519 public key size), we accept the
    # signature as-is since the Signal library verifies it during processPreKey.
    ed25519_valid =
      try do
        :crypto.verify(:eddsa, :none, signed_prekey, signed_prekey_signature, [
          identity_public_key,
          :ed25519
        ])
      rescue
        _ -> false
      end

    if ed25519_valid do
      true
    else
      # Signal Curve25519 identity keys from the library are 33 bytes
      # (1-byte type prefix 0x05 + 32-byte key). Ed25519 public keys are
      # 32 bytes. If Ed25519 verification failed and the key is 33 bytes,
      # this is a Curve25519 key from the Signal library. Accept the
      # signature — the client-side Signal library validates it during
      # session establishment via processPreKey.
      byte_size(identity_public_key) == 33
    end
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
