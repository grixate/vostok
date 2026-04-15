defmodule VostokServer.Calls.Params do
  @moduledoc false

  import Ecto.Query

  alias VostokServer.Calls.{CallRoomMember, CallSession}
  alias VostokServer.Identity.Device
  alias VostokServer.Messaging.ChatMember
  alias VostokServer.Repo

  def normalize_mode(attrs) do
    case attrs |> Map.get("mode") |> normalize_string() do
      nil -> {:ok, "voice"}
      "voice" = mode -> {:ok, mode}
      "video" = mode -> {:ok, mode}
      "group" = mode -> {:ok, mode}
      _ -> {:error, {:validation, "mode must be voice, video, or group."}}
    end
  end

  def normalize_media_mode("group", attrs) do
    normalize_room_media_mode(attrs)
  end

  def normalize_media_mode("voice", _attrs), do: {:ok, "voice"}
  def normalize_media_mode("video", _attrs), do: {:ok, "video"}

  def normalize_room_media_mode(attrs) do
    case attrs |> Map.get("media_mode") |> normalize_string() do
      nil -> {:ok, "voice"}
      "voice" = media_mode -> {:ok, media_mode}
      "video" = media_mode -> {:ok, media_mode}
      _ -> {:error, {:validation, "media_mode must be voice or video."}}
    end
  end

  def normalize_track_kind(%CallSession{mode: "voice"}, attrs) do
    case attrs |> Map.get("track_kind") |> normalize_string() do
      nil -> {:ok, "audio"}
      "audio" = track_kind -> {:ok, track_kind}
      _ -> {:error, {:validation, "track_kind must be audio for voice calls."}}
    end
  end

  def normalize_track_kind(_call, attrs) do
    if Map.get(attrs, "track_kind") == nil do
      {:ok, "audio_video"}
    else
      case attrs |> Map.get("track_kind") |> normalize_string() do
        nil -> {:ok, "audio_video"}
        "audio" = track_kind -> {:ok, track_kind}
        "video" = track_kind -> {:ok, track_kind}
        "audio_video" = track_kind -> {:ok, track_kind}
        _ -> {:error, {:validation, "track_kind must be audio, video, or audio_video."}}
      end
    end
  end

  def normalize_join_e2ee(
        %CallSession{} = call,
        attrs,
        current_device_id,
        ensure_fun
      )
      when is_map(attrs) do
    e2ee_capable = Map.get(attrs, "e2ee_capable", false) == true
    e2ee_algorithm =
      attrs
      |> Map.get("e2ee_algorithm")
      |> normalize_string()
      |> default_join_e2ee_algorithm(e2ee_capable)

    e2ee_key_epoch = parse_non_negative_integer(Map.get(attrs, "e2ee_key_epoch"))

    with :ok <-
           maybe_validate_join_e2ee(
             call,
             call.id,
             current_device_id,
             e2ee_capable,
             e2ee_algorithm,
             e2ee_key_epoch,
             ensure_fun
           ) do
      {:ok,
       %{
         e2ee_capable: e2ee_capable,
         e2ee_algorithm: if(e2ee_capable, do: e2ee_algorithm, else: nil),
         e2ee_key_epoch: if(e2ee_algorithm == "signal-v2", do: nil, else: e2ee_key_epoch)
       }}
    end
  end

  def normalize_signal_attrs(call_id, current_device_id, attrs) do
    signal_type =
      case attrs |> Map.get("signal_type") |> normalize_string() do
        "offer" = value ->
          {:ok, value}

        "answer" = value ->
          {:ok, value}

        "ice" = value ->
          {:ok, value}

        "renegotiate" = value ->
          {:ok, value}

        "heartbeat" = value ->
          {:ok, value}

        _ ->
          {:error,
           {:validation, "signal_type must be offer, answer, ice, renegotiate, or heartbeat."}}
      end

    payload =
      case attrs |> Map.get("payload") |> normalize_string() do
        nil -> {:error, {:validation, "payload is required."}}
        value -> {:ok, value}
      end

    target_device_id = attrs |> Map.get("target_device_id") |> normalize_string()

    with {:ok, normalized_signal_type} <- signal_type,
         {:ok, normalized_payload} <- payload do
      {:ok,
       %{
         call_id: call_id,
         from_device_id: current_device_id,
         target_device_id: target_device_id,
         signal_type: normalized_signal_type,
         payload: normalized_payload
       }}
    end
  end

  def normalize_media_event(attrs) do
    case attrs |> Map.get("event") |> normalize_string() do
      nil -> {:error, {:validation, "event is required."}}
      value -> {:ok, value}
    end
  end

  def normalize_call_key_distribution_attrs(attrs) do
    key_epoch = parse_non_negative_integer(Map.get(attrs, "key_epoch"))

    algorithm =
      attrs
      |> Map.get("algorithm")
      |> normalize_string()
      |> Kernel.||("sframe-aes-gcm-v1")

    wrapped_keys =
      case Map.get(attrs, "wrapped_keys") do
        map when is_map(map) and map_size(map) > 0 ->
          decode_wrapped_keys_map(map)

        _ ->
          {:error, {:validation, "wrapped_keys must be a non-empty object."}}
      end

    with {:ok, wrapped_key_map} <- wrapped_keys do
      recipient_device_ids = wrapped_key_map |> Map.keys() |> Enum.uniq()

      {:ok,
       %{
         key_epoch: key_epoch || 0,
         algorithm: algorithm,
         wrapped_keys: wrapped_key_map,
         recipient_device_ids: recipient_device_ids
       }}
    end
  end

  def resolve_call_key_recipients(call_id, current_device_id, recipient_device_ids)
      when is_binary(call_id) and is_binary(current_device_id) and is_list(recipient_device_ids) do
    active_chat_devices =
      case Repo.get(CallSession, call_id) do
        %CallSession{scope_type: "chat", chat_id: chat_id} ->
          from(member in ChatMember,
            where: member.chat_id == ^chat_id,
            join: device in Device,
            on: device.user_id == member.user_id and is_nil(device.revoked_at),
            select: device.id
          )
          |> Repo.all()

        %CallSession{scope_type: "call_room", call_room_id: room_id} ->
          from(member in CallRoomMember,
            where: member.call_room_id == ^room_id and is_nil(member.left_at),
            join: device in Device,
            on: device.user_id == member.user_id and is_nil(device.revoked_at),
            select: device.id
          )
          |> Repo.all()

        _ ->
          []
      end
      |> Enum.reject(&(&1 == current_device_id))
      |> Enum.uniq()

    requested_recipients =
      recipient_device_ids
      |> Enum.reject(&(&1 == current_device_id))
      |> Enum.uniq()

    if requested_recipients == [] do
      if active_chat_devices == [] do
        {:error,
         {:validation, "No active recipient devices are available for call key rotation."}}
      else
        {:ok, active_chat_devices}
      end
    else
      expected = MapSet.new(active_chat_devices)
      requested = MapSet.new(requested_recipients)

      if MapSet.subset?(requested, expected) do
        {:ok, requested_recipients}
      else
        {:error,
         {:validation, "wrapped_keys includes a device that is not an active chat device."}}
      end
    end
  end

  def normalize_user_id_list(value) when is_list(value) do
    value
    |> Enum.map(&normalize_string/1)
    |> Enum.reject(&is_nil/1)
  end

  def normalize_user_id_list(_value), do: []

  defp default_join_e2ee_algorithm(nil, true), do: "signal-v2"
  defp default_join_e2ee_algorithm(algorithm, _e2ee_capable), do: algorithm

  defp maybe_validate_join_e2ee(
         _call,
         _call_id,
         _current_device_id,
         false,
         _e2ee_algorithm,
         _e2ee_key_epoch,
         _ensure_fun
       ),
       do: :ok

  defp maybe_validate_join_e2ee(
         _call,
         _call_id,
         _current_device_id,
         true,
         "signal-v2",
         _e2ee_key_epoch,
         _ensure_fun
       ),
       do: :ok

  defp maybe_validate_join_e2ee(
         %CallSession{mode: "group"},
         _call_id,
         _current_device_id,
         true,
         _e2ee_algorithm,
         nil,
         _ensure_fun
       ) do
    {:error, {:validation, "e2ee_key_epoch must be a non-negative integer when e2ee_capable is true."}}
  end

  defp maybe_validate_join_e2ee(
         %CallSession{mode: "group"},
         call_id,
         current_device_id,
         true,
         _e2ee_algorithm,
         e2ee_key_epoch,
         ensure_fun
       ) do
    ensure_fun.(call_id, current_device_id, e2ee_key_epoch)
  end

  defp maybe_validate_join_e2ee(
         %CallSession{},
         _call_id,
         _current_device_id,
         true,
         _e2ee_algorithm,
         _e2ee_key_epoch,
         _ensure_fun
       ) do
    {:error, {:validation, "Only signal-v2 media encryption is supported for non-group calls."}}
  end

  defp decode_wrapped_keys_map(map) when is_map(map) do
    map
    |> Enum.reduce_while({:ok, %{}}, fn
      {device_id, wrapped_key_base64}, {:ok, acc}
      when is_binary(device_id) and is_binary(wrapped_key_base64) ->
        case Base.decode64(wrapped_key_base64) do
          {:ok, wrapped_key} ->
            {:cont, {:ok, Map.put(acc, device_id, wrapped_key)}}

          :error ->
            {:halt, {:error, {:validation, "wrapped_keys.#{device_id} must be valid base64."}}}
        end

      _entry, _acc ->
        {:halt, {:error, {:validation, "wrapped_keys must map device ids to base64 strings."}}}
    end)
  end

  defp parse_non_negative_integer(value) when is_integer(value) and value >= 0, do: value

  defp parse_non_negative_integer(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {parsed, ""} when parsed >= 0 -> parsed
      _ -> nil
    end
  end

  defp parse_non_negative_integer(_value), do: nil

  def normalize_string(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  def normalize_string(_), do: nil
end
