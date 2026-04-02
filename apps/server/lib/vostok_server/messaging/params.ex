defmodule VostokServer.Messaging.Params do
  @moduledoc false

  import Ecto.Query

  alias VostokServer.Identity.{Device, User}
  alias VostokServer.Messaging.ChatMember
  alias VostokServer.Repo

  def fetch_string(attrs, key, label) do
    case attrs |> Map.get(key) |> normalize_string() do
      nil -> {:error, {:validation, "#{label} is required."}}
      value -> {:ok, value}
    end
  end

  def fetch_optional_string(attrs, key) do
    {:ok, attrs |> Map.get(key) |> normalize_string()}
  end

  def fetch_optional_integer(attrs, key) do
    case Map.get(attrs, key) do
      nil ->
        {:ok, nil}

      value when is_integer(value) and value >= 0 ->
        {:ok, value}

      value when is_binary(value) ->
        case Integer.parse(String.trim(value)) do
          {parsed, ""} when parsed >= 0 -> {:ok, parsed}
          _ -> {:error, {:validation, "#{key} must be a non-negative integer."}}
        end

      _other ->
        {:error, {:validation, "#{key} must be a non-negative integer."}}
    end
  end

  def fetch_optional_boolean(attrs, key) do
    case Map.get(attrs, key) do
      nil ->
        {:ok, false}

      value when value in [true, false] ->
        {:ok, value}

      value when is_binary(value) ->
        case String.downcase(String.trim(value)) do
          "true" -> {:ok, true}
          "false" -> {:ok, false}
          _ -> {:error, {:validation, "#{key} must be a boolean."}}
        end

      _other ->
        {:error, {:validation, "#{key} must be a boolean."}}
    end
  end

  def fetch_base64(attrs, key, label) do
    case attrs |> Map.get(key) |> normalize_string() do
      nil ->
        {:error, {:validation, "#{label} is required."}}

      value ->
        case Base.decode64(value) do
          {:ok, decoded} -> {:ok, decoded}
          :error -> {:error, {:validation, "#{label} must be valid base64."}}
        end
    end
  end

  def fetch_optional_base64(attrs, key) do
    case attrs |> Map.get(key) |> normalize_string() do
      nil ->
        {:ok, nil}

      value ->
        case Base.decode64(value) do
          {:ok, decoded} -> {:ok, decoded}
          :error -> {:error, {:validation, "#{key} must be valid base64."}}
        end
    end
  end

  def fetch_optional_recipient_envelopes(attrs) do
    case Map.get(attrs, "recipient_envelopes") do
      nil ->
        {:ok, nil}

      recipient_envelopes when is_map(recipient_envelopes) ->
        Enum.reduce_while(recipient_envelopes, {:ok, %{}}, fn
          {device_id, payload_base64}, {:ok, decoded} when is_binary(device_id) ->
            case normalize_string(payload_base64) do
              nil ->
                {:halt,
                 {:error,
                  {:validation, "recipient_envelopes values must be valid base64 strings."}}}

              payload ->
                case Base.decode64(payload) do
                  {:ok, decoded_payload} ->
                    {:cont, {:ok, Map.put(decoded, device_id, decoded_payload)}}

                  :error ->
                    {:halt,
                     {:error,
                      {:validation, "recipient_envelopes values must be valid base64 strings."}}}
                end
            end

          _, _acc ->
            {:halt, {:error, {:validation, "recipient_envelopes must be a map of device ids."}}}
        end)

      _ ->
        {:error, {:validation, "recipient_envelopes must be a map of device ids."}}
    end
  end

  def fetch_optional_id_list(attrs, key) do
    case Map.get(attrs, key) do
      nil ->
        {:ok, []}

      values when is_list(values) ->
        values
        |> Enum.reduce_while({:ok, []}, fn
          value, {:ok, acc} ->
            case normalize_string(value) do
              nil ->
                {:halt, {:error, {:validation, "#{key} must contain valid ids."}}}

              normalized ->
                {:cont, {:ok, [normalized | acc]}}
            end
        end)
        |> case do
          {:ok, ids} -> {:ok, Enum.reverse(ids)}
          {:error, reason} -> {:error, reason}
        end

      _ ->
        {:error, {:validation, "#{key} must be a list of ids."}}
    end
  end

  def normalize_sender_key_distribution(attrs) do
    with {:ok, key_id} <- fetch_string(attrs, "key_id", "sender key id"),
         {:ok, sender_key_epoch} <- fetch_optional_integer(attrs, "sender_key_epoch"),
         {:ok, wrapped_sender_keys} <- fetch_sender_key_map(attrs, "wrapped_keys"),
         {:ok, algorithm} <- fetch_optional_string(attrs, "algorithm"),
         {:ok, recipient_wrapped_keys} <- decode_sender_key_map(wrapped_sender_keys) do
      recipient_device_ids = recipient_wrapped_keys |> Enum.map(&elem(&1, 0)) |> Enum.uniq()

      {:ok,
       %{
         key_id: key_id,
         sender_key_epoch: sender_key_epoch || 0,
         algorithm: algorithm || "p256-ecdh+a256gcm",
         recipient_device_ids: recipient_device_ids,
         recipient_wrapped_keys: recipient_wrapped_keys
       }}
    end
  end

  def resolve_group_sender_key_recipients(chat_id, recipient_device_ids)
      when is_list(recipient_device_ids) do
    recipient_device_ids = Enum.uniq(recipient_device_ids)

    devices =
      from(chat_member in ChatMember,
        join: device in Device,
        on: device.user_id == chat_member.user_id and is_nil(device.revoked_at),
        where: chat_member.chat_id == ^chat_id and device.id in ^recipient_device_ids,
        select: device.id
      )
      |> Repo.all()
      |> MapSet.new()

    expected = MapSet.new(recipient_device_ids)

    if MapSet.equal?(devices, expected) do
      {:ok, recipient_device_ids}
    else
      {:error,
       {:validation,
        "wrapped_keys must only contain active recipient devices in this group chat."}}
    end
  end

  def resolve_safety_peer_device(chat_id, peer_device_id) do
    from(chat_member in ChatMember,
      join: user in User,
      on: user.id == chat_member.user_id,
      join: device in Device,
      on:
        device.user_id == chat_member.user_id and is_nil(device.revoked_at) and
          not is_nil(device.identity_public_key),
      where: chat_member.chat_id == ^chat_id and device.id == ^peer_device_id,
      select: %{
        user_id: user.id,
        username: user.username,
        device_id: device.id,
        device_name: device.device_name,
        identity_public_key: device.identity_public_key
      },
      limit: 1
    )
    |> Repo.one()
    |> case do
      nil -> {:error, {:not_found, "Peer device is not available in this chat."}}
      peer -> {:ok, peer}
    end
  end

  def ensure_device_belongs_to_user(%Device{user_id: user_id}, user_id), do: :ok

  def ensure_device_belongs_to_user(_device, _user_id),
    do: {:error, {:unauthorized, "Verifier device does not belong to the authenticated user."}}

  def ensure_not_self_safety_device(device_id, device_id),
    do: {:error, {:validation, "Cannot verify the active device fingerprint against itself."}}

  def ensure_not_self_safety_device(_left, _right), do: :ok

  def safety_number_fingerprint(local_identity_public_key, remote_identity_public_key)
      when is_binary(local_identity_public_key) and is_binary(remote_identity_public_key) do
    [left, right] = Enum.sort([local_identity_public_key, remote_identity_public_key])

    <<digest::binary-size(32)>> = :crypto.hash(:sha256, left <> right)

    digits =
      digest
      |> :binary.bin_to_list()
      |> Enum.map(&(Integer.to_string(rem(&1, 100)) |> String.pad_leading(2, "0")))
      |> Enum.join("")
      |> binary_part(0, 30)

    digits
    |> String.codepoints()
    |> Enum.chunk_every(5)
    |> Enum.map_join(" ", &Enum.join/1)
  end

  def fetch_username_list(attrs, key) do
    case Map.get(attrs, key) do
      nil ->
        {:ok, []}

      usernames when is_list(usernames) ->
        usernames
        |> Enum.reduce_while({:ok, []}, fn
          username, {:ok, acc} ->
            case normalize_string(username) do
              nil -> {:halt, {:error, {:validation, "#{key} must contain valid usernames."}}}
              normalized -> {:cont, {:ok, [normalized | acc]}}
            end
        end)
        |> case do
          {:ok, normalized} -> {:ok, normalized |> Enum.reverse() |> Enum.uniq()}
          {:error, reason} -> {:error, reason}
        end

      _ ->
        {:error, {:validation, "#{key} must be a list of usernames."}}
    end
  end

  def resolve_group_members(%User{} = current_user, member_usernames) do
    usernames =
      [current_user.username | member_usernames]
      |> Enum.uniq()

    users =
      from(user in User, where: user.username in ^usernames)
      |> Repo.all()

    users_by_username = Map.new(users, &{&1.username, &1})

    missing_usernames = Enum.reject(usernames, &Map.has_key?(users_by_username, &1))

    if missing_usernames == [] do
      members =
        Enum.map(usernames, fn username ->
          role = if username == current_user.username, do: "admin", else: "member"
          {Map.fetch!(users_by_username, username), role}
        end)

      {:ok, members}
    else
      {:error, {:not_found, "One or more group members were not found."}}
    end
  end

  def normalize_string(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  def normalize_string(_), do: nil

  defp fetch_sender_key_map(attrs, key) do
    case Map.get(attrs, key) do
      map when is_map(map) and map_size(map) > 0 ->
        if Enum.all?(map, fn {map_key, _value} -> is_binary(map_key) end) do
          {:ok, map}
        else
          {:error, {:validation, "#{key} must be keyed by recipient device id strings."}}
        end

      _ ->
        {:error, {:validation, "#{key} must be a non-empty object keyed by recipient device id."}}
    end
  end

  defp decode_sender_key_map(sender_key_map) when is_map(sender_key_map) do
    sender_key_map
    |> Enum.reduce_while({:ok, []}, fn {recipient_device_id, wrapped_sender_key_base64},
                                       {:ok, decoded} ->
      case decode_sender_key_payload(recipient_device_id, wrapped_sender_key_base64) do
        {:ok, wrapped_sender_key} ->
          {:cont, {:ok, [{recipient_device_id, wrapped_sender_key} | decoded]}}

        {:error, reason} ->
          {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, decoded} -> {:ok, Enum.reverse(decoded)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp decode_sender_key_payload(recipient_device_id, wrapped_sender_key_base64)
       when is_binary(recipient_device_id) and is_binary(wrapped_sender_key_base64) do
    case Base.decode64(wrapped_sender_key_base64) do
      {:ok, wrapped_sender_key} ->
        {:ok, wrapped_sender_key}

      :error ->
        {:error,
         {:validation,
          "wrapped_keys.#{recipient_device_id} must be a base64-encoded wrapped sender key."}}
    end
  end

  defp decode_sender_key_payload(recipient_device_id, _wrapped_sender_key_base64)
       when is_binary(recipient_device_id) do
    {:error,
     {:validation,
      "wrapped_keys.#{recipient_device_id} must be a base64-encoded wrapped sender key."}}
  end
end
