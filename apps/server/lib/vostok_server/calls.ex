defmodule VostokServer.Calls do
  @moduledoc """
  Stage 7 call session context with Membrane room orchestration and E2EE key epoch coordination.
  """

  import Ecto.Query

  alias VostokServer.Calls.{
    CallKeyDistribution,
    CallParticipant,
    CallSession,
    CallSignal,
    MembraneRoom,
    RoomSupervisor
  }

  alias VostokServer.Identity.Device
  alias VostokServer.Messaging.ChatMember
  alias VostokServer.Messaging
  alias VostokServer.Repo

  def active_call_for_chat(chat_id, user_id) when is_binary(chat_id) and is_binary(user_id) do
    with {:ok, _membership} <- Messaging.ensure_membership(chat_id, user_id) do
      call =
        from(call in CallSession,
          where: call.chat_id == ^chat_id and call.status == "active",
          order_by: [desc: call.started_at],
          limit: 1
        )
        |> Repo.one()

      maybe_ensure_room(call)
      {:ok, present_call(call)}
    end
  end

  def start_call(chat_id, user_id, current_device_id, attrs)
      when is_binary(chat_id) and is_binary(user_id) and is_binary(current_device_id) and
             is_map(attrs) do
    with {:ok, _membership} <- Messaging.ensure_membership(chat_id, user_id),
         {:ok, mode} <- normalize_mode(attrs) do
      case active_call_record(chat_id) do
        %CallSession{} = call ->
          maybe_ensure_room(call)
          broadcast_call_state(chat_id, call)
          {:ok, present_call(call)}

        nil ->
          %CallSession{}
          |> CallSession.changeset(%{
            chat_id: chat_id,
            started_by_device_id: current_device_id,
            mode: mode,
            status: "active",
            started_at: DateTime.utc_now()
          })
          |> Repo.insert()
          |> case do
            {:ok, call} ->
              maybe_ensure_room(call)
              broadcast_call_state(chat_id, call)
              emit_call_history_message(call, "#{String.capitalize(mode)} call started")
              {:ok, present_call(call)}

            {:error, changeset} ->
              {:error, {:validation, format_changeset_error(changeset)}}
          end
      end
    end
  end

  def call_state(call_id, user_id) when is_binary(call_id) and is_binary(user_id) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Messaging.ensure_membership(call.chat_id, user_id) do
      maybe_ensure_room(call)

      {:ok,
       %{
         call: present_call(call),
         participants: list_presented_participants(call.id),
         signals: list_presented_signals(call.id),
         room: current_room_state(call)
       }}
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def join_call(call_id, user_id, current_device_id, attrs)
      when is_binary(call_id) and is_binary(user_id) and is_binary(current_device_id) and
             is_map(attrs) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Messaging.ensure_membership(call.chat_id, user_id),
         :ok <- ensure_active(call),
         {:ok, track_kind} <- normalize_track_kind(call, attrs),
         {:ok, e2ee_attrs} <- normalize_join_e2ee(call, attrs, current_device_id),
         {:ok, _room, _pid} <- RoomSupervisor.ensure_room(call.id, call.mode),
         {:ok, participant} <-
           upsert_participant(call, user_id, current_device_id, track_kind, e2ee_attrs) do
      ensure_bridge_endpoint(call, current_device_id, %{
        user_id: user_id,
        track_kind: track_kind,
        source: "join_call"
      })

      room = MembraneRoom.join(call.id, present_participant(participant))
      participants = list_presented_participants(call.id)
      broadcast_participant_state(call.chat_id, call.id, participants, room)

      {:ok,
       %{
         call: present_call(call),
         participant: present_participant(participant),
         participants: participants,
         room: room
       }}
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def leave_call(call_id, user_id, current_device_id)
      when is_binary(call_id) and is_binary(user_id) and is_binary(current_device_id) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Messaging.ensure_membership(call.chat_id, user_id),
         {:ok, participant} <- mark_participant_left(call.id, current_device_id) do
      room =
        case current_room_state(call) do
          nil ->
            nil

          _room ->
            MembraneRoom.remove_webrtc_endpoint(call.id, current_device_id)
            MembraneRoom.leave(call.id, current_device_id)
        end

      participants = list_presented_participants(call.id)
      broadcast_participant_state(call.chat_id, call.id, participants, room)

      {:ok,
       %{
         call: present_call(call),
         participant: present_participant(participant),
         participants: participants,
         room: room
       }}
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def end_call(call_id, user_id) when is_binary(call_id) and is_binary(user_id) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Messaging.ensure_membership(call.chat_id, user_id) do
      completion_message = call_completion_message(call)

      call
      |> CallSession.changeset(%{
        status: "ended",
        ended_at: DateTime.utc_now()
      })
      |> Repo.update()
      |> case do
        {:ok, updated} ->
          mark_all_participants_left(updated.id)
          RoomSupervisor.stop_room(updated.id)

          broadcast_participant_state(
            updated.chat_id,
            updated.id,
            list_presented_participants(updated.id),
            nil
          )

          broadcast_call_state(updated.chat_id, updated)
          emit_call_history_message(updated, completion_message)
          {:ok, present_call(updated)}

        {:error, changeset} ->
          {:error, {:validation, format_changeset_error(changeset)}}
      end
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def list_signals(call_id, user_id) when is_binary(call_id) and is_binary(user_id) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Messaging.ensure_membership(call.chat_id, user_id) do
      {:ok,
       %{
         call: present_call(call),
         signals: list_presented_signals(call.id)
       }}
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def list_call_keys(call_id, user_id, current_device_id)
      when is_binary(call_id) and is_binary(user_id) and is_binary(current_device_id) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Messaging.ensure_membership(call.chat_id, user_id) do
      keys =
        from(distribution in CallKeyDistribution,
          where:
            distribution.call_id == ^call_id and
              distribution.recipient_device_id == ^current_device_id and
              distribution.status == "active",
          order_by: [desc: distribution.key_epoch, desc: distribution.inserted_at]
        )
        |> Repo.all()
        |> Enum.map(&present_call_key_distribution/1)

      {:ok,
       %{
         call: present_call(call),
         keys: keys
       }}
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def rotate_call_keys(call_id, user_id, current_device_id, attrs)
      when is_binary(call_id) and is_binary(user_id) and is_binary(current_device_id) and
             is_map(attrs) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Messaging.ensure_membership(call.chat_id, user_id),
         :ok <- ensure_active(call),
         {:ok, normalized} <- normalize_call_key_distribution_attrs(attrs),
         {:ok, recipient_device_ids} <-
           resolve_call_key_recipients(
             call.id,
             current_device_id,
             normalized.recipient_device_ids
           ) do
      Repo.transaction(fn ->
        recipient_device_ids
        |> Enum.reduce([], fn recipient_device_id, inserted ->
          from(distribution in CallKeyDistribution,
            where:
              distribution.call_id == ^call.id and
                distribution.owner_device_id == ^current_device_id and
                distribution.recipient_device_id == ^recipient_device_id and
                distribution.status == "active" and
                distribution.key_epoch != ^normalized.key_epoch
          )
          |> Repo.update_all(set: [status: "superseded", updated_at: DateTime.utc_now()])

          wrapped_key = Map.fetch!(normalized.wrapped_keys, recipient_device_id)

          record =
            case Repo.get_by(CallKeyDistribution,
                   call_id: call.id,
                   owner_device_id: current_device_id,
                   recipient_device_id: recipient_device_id,
                   key_epoch: normalized.key_epoch
                 ) do
              %CallKeyDistribution{} = existing ->
                existing
                |> CallKeyDistribution.changeset(%{
                  algorithm: normalized.algorithm,
                  wrapped_key: wrapped_key,
                  status: "active"
                })
                |> Repo.update()

              nil ->
                %CallKeyDistribution{}
                |> CallKeyDistribution.changeset(%{
                  call_id: call.id,
                  owner_device_id: current_device_id,
                  recipient_device_id: recipient_device_id,
                  key_epoch: normalized.key_epoch,
                  algorithm: normalized.algorithm,
                  wrapped_key: wrapped_key,
                  status: "active"
                })
                |> Repo.insert()
            end

          case record do
            {:ok, distribution} ->
              [present_call_key_distribution(distribution) | inserted]

            {:error, changeset} ->
              Repo.rollback({:validation, format_changeset_error(changeset)})
          end
        end)
        |> Enum.reverse()
      end)
      |> case do
        {:ok, keys} ->
          {:ok, %{call: present_call(call), keys: keys}}

        {:error, reason} ->
          {:error, reason}
      end
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def emit_signal(call_id, user_id, current_device_id, attrs)
      when is_binary(call_id) and is_binary(user_id) and is_binary(current_device_id) and
             is_map(attrs) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Messaging.ensure_membership(call.chat_id, user_id),
         :ok <- ensure_active(call),
         {:ok, signal_attrs} <- normalize_signal_attrs(call.id, current_device_id, attrs),
         {:ok, signal} <- insert_signal(signal_attrs) do
      presented_signal = present_signal(signal)
      maybe_ensure_room(call)
      broadcast_signal(call.chat_id, presented_signal)

      {:ok,
       %{
         call: present_call(call),
         signal: presented_signal
       }}
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def provision_webrtc_endpoint(call_id, user_id, current_device_id)
      when is_binary(call_id) and is_binary(user_id) and is_binary(current_device_id) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Messaging.ensure_membership(call.chat_id, user_id),
         :ok <- ensure_active(call),
         {:ok, _room, _pid} <- RoomSupervisor.ensure_room(call.id, call.mode) do
      endpoint =
        MembraneRoom.ensure_webrtc_endpoint(call.id, current_device_id, %{
          call_id: call.id,
          device_id: current_device_id,
          user_id: user_id
        })

      {:ok,
       %{
         call: present_call(call),
         endpoint: endpoint,
         room: current_room_state(call)
       }}
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def get_webrtc_endpoint_state(call_id, user_id, current_device_id)
      when is_binary(call_id) and is_binary(user_id) and is_binary(current_device_id) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Messaging.ensure_membership(call.chat_id, user_id) do
      endpoint = MembraneRoom.endpoint_state(call.id, current_device_id)

      {:ok,
       %{
         call: present_call(call),
         endpoint: endpoint,
         room: current_room_state(call)
       }}
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def push_webrtc_media_event(call_id, user_id, current_device_id, attrs)
      when is_binary(call_id) and is_binary(user_id) and is_binary(current_device_id) and
             is_map(attrs) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Messaging.ensure_membership(call.chat_id, user_id),
         {:ok, event} <- normalize_media_event(attrs) do
      result = MembraneRoom.forward_media_event(call.id, current_device_id, event)

      {:ok,
       %{
         call: present_call(call),
         endpoint: result.endpoint,
         media_events: result.media_events
       }}
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def poll_webrtc_media_events(call_id, user_id, current_device_id)
      when is_binary(call_id) and is_binary(user_id) and is_binary(current_device_id) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Messaging.ensure_membership(call.chat_id, user_id) do
      result = MembraneRoom.poll_media_events(call.id, current_device_id)

      {:ok,
       %{
         call: present_call(call),
         endpoint: result.endpoint,
         media_events: result.media_events
       }}
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp active_call_record(chat_id) do
    from(call in CallSession,
      where: call.chat_id == ^chat_id and call.status == "active",
      order_by: [desc: call.started_at],
      limit: 1
    )
    |> Repo.one()
  end

  defp maybe_ensure_room(%CallSession{status: "active"} = call) do
    case RoomSupervisor.ensure_room(call.id, call.mode) do
      {:ok, _room, _pid} -> :ok
      {:error, _reason} -> :ok
    end
  end

  defp maybe_ensure_room(_call), do: :ok

  defp ensure_active(%CallSession{status: "active"}), do: :ok
  defp ensure_active(_call), do: {:error, {:validation, "Call is no longer active."}}

  defp normalize_mode(attrs) do
    case attrs |> Map.get("mode") |> normalize_string() do
      nil -> {:ok, "voice"}
      "voice" = mode -> {:ok, mode}
      "video" = mode -> {:ok, mode}
      "group" = mode -> {:ok, mode}
      _ -> {:error, {:validation, "mode must be voice, video, or group."}}
    end
  end

  defp normalize_track_kind(%CallSession{mode: "voice"}, attrs) do
    case attrs |> Map.get("track_kind") |> normalize_string() do
      nil -> {:ok, "audio"}
      "audio" = track_kind -> {:ok, track_kind}
      _ -> {:error, {:validation, "track_kind must be audio for voice calls."}}
    end
  end

  defp normalize_track_kind(_call, attrs) do
    case attrs |> Map.get("track_kind") |> normalize_string() do
      nil -> {:ok, "audio_video"}
      "audio" = track_kind -> {:ok, track_kind}
      "video" = track_kind -> {:ok, track_kind}
      "audio_video" = track_kind -> {:ok, track_kind}
      _ -> {:error, {:validation, "track_kind must be audio, video, or audio_video."}}
    end
  end

  defp normalize_join_e2ee(%CallSession{mode: "group"} = call, attrs, current_device_id)
       when is_map(attrs) and is_binary(current_device_id) do
    with {:ok, true} <- fetch_required_boolean(attrs, "e2ee_capable"),
         {:ok, algorithm} <- fetch_required_string(attrs, "e2ee_algorithm"),
         {:ok, key_epoch} <- fetch_required_non_negative_integer(attrs, "e2ee_key_epoch"),
         :ok <- ensure_group_join_key_available(call.id, current_device_id, key_epoch) do
      {:ok,
       %{
         e2ee_capable: true,
         e2ee_algorithm: algorithm,
         e2ee_key_epoch: key_epoch
       }}
    end
  end

  defp normalize_join_e2ee(%CallSession{}, _attrs, _current_device_id) do
    {:ok, %{e2ee_capable: false, e2ee_algorithm: nil, e2ee_key_epoch: nil}}
  end

  defp ensure_group_join_key_available(call_id, current_device_id, key_epoch)
       when is_binary(call_id) and is_binary(current_device_id) and is_integer(key_epoch) do
    other_joined_count =
      from(participant in CallParticipant,
        where:
          participant.call_id == ^call_id and participant.status == "joined" and
            participant.device_id != ^current_device_id,
        select: count(participant.id)
      )
      |> Repo.one()

    if other_joined_count == 0 do
      :ok
    else
      distribution_count =
        from(distribution in CallKeyDistribution,
          where:
            distribution.call_id == ^call_id and
              distribution.recipient_device_id == ^current_device_id and
              distribution.key_epoch == ^key_epoch and
              distribution.status == "active",
          select: count(distribution.id)
        )
        |> Repo.one()

      if distribution_count > 0 do
        :ok
      else
        {:error,
         {:validation,
          "Group call join requires an active call key distribution for this device and epoch."}}
      end
    end
  end

  defp normalize_signal_attrs(call_id, current_device_id, attrs) do
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

  defp normalize_media_event(attrs) do
    case attrs |> Map.get("event") |> normalize_string() do
      nil -> {:error, {:validation, "event is required."}}
      value -> {:ok, value}
    end
  end

  defp normalize_call_key_distribution_attrs(attrs) do
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

  defp resolve_call_key_recipients(call_id, current_device_id, recipient_device_ids)
       when is_binary(call_id) and is_binary(current_device_id) and is_list(recipient_device_ids) do
    active_chat_devices =
      from(call in CallSession,
        where: call.id == ^call_id,
        join: member in ChatMember,
        on: member.chat_id == call.chat_id,
        join: device in Device,
        on: device.user_id == member.user_id and is_nil(device.revoked_at),
        select: device.id
      )
      |> Repo.all()
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

  defp parse_non_negative_integer(value) when is_integer(value) and value >= 0, do: value

  defp parse_non_negative_integer(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {parsed, ""} when parsed >= 0 -> parsed
      _ -> nil
    end
  end

  defp parse_non_negative_integer(_value), do: nil

  defp present_call(nil), do: nil

  defp present_call(%CallSession{} = call) do
    %{
      id: call.id,
      chat_id: call.chat_id,
      started_by_device_id: call.started_by_device_id,
      mode: call.mode,
      status: call.status,
      started_at: iso_or_nil(call.started_at),
      ended_at: iso_or_nil(call.ended_at)
    }
  end

  defp present_participant(%CallParticipant{} = participant) do
    %{
      id: participant.id,
      call_id: participant.call_id,
      user_id: participant.user_id,
      device_id: participant.device_id,
      status: participant.status,
      track_kind: participant.track_kind,
      e2ee_capable: participant.e2ee_capable,
      e2ee_algorithm: participant.e2ee_algorithm,
      e2ee_key_epoch: participant.e2ee_key_epoch,
      joined_at: iso_or_nil(participant.joined_at),
      left_at: iso_or_nil(participant.left_at)
    }
  end

  defp present_signal(%CallSignal{} = signal) do
    %{
      id: signal.id,
      call_id: signal.call_id,
      from_device_id: signal.from_device_id,
      target_device_id: signal.target_device_id,
      signal_type: signal.signal_type,
      payload: signal.payload,
      inserted_at: iso_or_nil(signal.inserted_at)
    }
  end

  defp present_call_key_distribution(%CallKeyDistribution{} = distribution) do
    %{
      id: distribution.id,
      call_id: distribution.call_id,
      owner_device_id: distribution.owner_device_id,
      recipient_device_id: distribution.recipient_device_id,
      key_epoch: distribution.key_epoch,
      algorithm: distribution.algorithm,
      status: distribution.status,
      wrapped_key: Base.encode64(distribution.wrapped_key),
      inserted_at: iso_or_nil(distribution.inserted_at),
      updated_at: iso_or_nil(distribution.updated_at)
    }
  end

  defp normalize_string(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_string(_), do: nil

  defp format_changeset_error(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
    |> Enum.map(fn {field, [message | _]} -> "#{field} #{message}" end)
    |> List.first()
    |> Kernel.||("The call session could not be saved.")
  end

  defp upsert_participant(call, user_id, current_device_id, track_kind, e2ee_attrs) do
    now = DateTime.utc_now()

    case Repo.get_by(CallParticipant, call_id: call.id, device_id: current_device_id) do
      %CallParticipant{} = participant ->
        participant
        |> CallParticipant.changeset(%{
          user_id: user_id,
          status: "joined",
          track_kind: track_kind,
          e2ee_capable: Map.get(e2ee_attrs, :e2ee_capable, false),
          e2ee_algorithm: Map.get(e2ee_attrs, :e2ee_algorithm),
          e2ee_key_epoch: Map.get(e2ee_attrs, :e2ee_key_epoch),
          joined_at: participant.joined_at || now,
          left_at: nil
        })
        |> Repo.update()
        |> normalize_participant_result()

      nil ->
        %CallParticipant{}
        |> CallParticipant.changeset(%{
          call_id: call.id,
          user_id: user_id,
          device_id: current_device_id,
          status: "joined",
          track_kind: track_kind,
          e2ee_capable: Map.get(e2ee_attrs, :e2ee_capable, false),
          e2ee_algorithm: Map.get(e2ee_attrs, :e2ee_algorithm),
          e2ee_key_epoch: Map.get(e2ee_attrs, :e2ee_key_epoch),
          joined_at: now
        })
        |> Repo.insert()
        |> normalize_participant_result()
    end
  end

  defp mark_participant_left(call_id, current_device_id) do
    case Repo.get_by(CallParticipant, call_id: call_id, device_id: current_device_id) do
      %CallParticipant{} = participant ->
        participant
        |> CallParticipant.changeset(%{
          status: "left",
          left_at: DateTime.utc_now()
        })
        |> Repo.update()
        |> normalize_participant_result()

      nil ->
        {:error, {:not_found, "Participant is not part of this call."}}
    end
  end

  defp mark_all_participants_left(call_id) do
    from(participant in CallParticipant,
      where: participant.call_id == ^call_id and participant.status == "joined"
    )
    |> Repo.update_all(set: [status: "left", left_at: DateTime.utc_now()])
  end

  defp insert_signal(signal_attrs) do
    %CallSignal{}
    |> CallSignal.changeset(signal_attrs)
    |> Repo.insert()
    |> case do
      {:ok, signal} -> {:ok, signal}
      {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
    end
  end

  defp emit_call_history_message(%CallSession{} = call, text) when is_binary(text) do
    _ = Messaging.create_system_message(call.chat_id, call.started_by_device_id, text)
    :ok
  end

  defp call_completion_message(%CallSession{} = call) do
    if remote_participant_joined?(call.id, call.started_by_device_id) do
      "#{String.capitalize(call.mode)} call ended"
    else
      "Missed #{call.mode} call"
    end
  end

  defp remote_participant_joined?(call_id, started_by_device_id) do
    from(participant in CallParticipant,
      where: participant.call_id == ^call_id and participant.device_id != ^started_by_device_id,
      select: count(participant.id)
    )
    |> Repo.one()
    |> Kernel.>(0)
  end

  defp ensure_bridge_endpoint(%CallSession{} = call, endpoint_id, metadata)
       when is_binary(endpoint_id) and is_map(metadata) do
    merged_metadata =
      Map.merge(
        %{
          call_id: call.id,
          device_id: endpoint_id
        },
        metadata
      )

    MembraneRoom.ensure_webrtc_endpoint(call.id, endpoint_id, merged_metadata)
  end

  defp list_presented_participants(call_id) do
    from(participant in CallParticipant,
      where: participant.call_id == ^call_id,
      order_by: [asc: participant.inserted_at]
    )
    |> Repo.all()
    |> Enum.map(&present_participant/1)
  end

  defp list_presented_signals(call_id) do
    from(signal in CallSignal,
      where: signal.call_id == ^call_id,
      order_by: [asc: signal.inserted_at],
      limit: 50
    )
    |> Repo.all()
    |> Enum.map(&present_signal/1)
  end

  defp current_room_state(%CallSession{status: "active"} = call) do
    MembraneRoom.describe(call.id)
  end

  defp current_room_state(_call), do: nil

  defp normalize_participant_result({:ok, participant}), do: {:ok, participant}

  defp normalize_participant_result({:error, changeset}) do
    {:error, {:validation, format_changeset_error(changeset)}}
  end

  defp iso_or_nil(nil), do: nil
  defp iso_or_nil(%DateTime{} = value), do: DateTime.to_iso8601(value)

  defp fetch_required_boolean(attrs, field) when is_map(attrs) and is_binary(field) do
    case Map.get(attrs, field) do
      true -> {:ok, true}
      "true" -> {:ok, true}
      "1" -> {:ok, true}
      1 -> {:ok, true}
      false -> {:error, {:validation, "#{field} must be true for group call E2EE."}}
      "false" -> {:error, {:validation, "#{field} must be true for group call E2EE."}}
      nil -> {:error, {:validation, "#{field} is required for group call E2EE."}}
      _ -> {:error, {:validation, "#{field} must be true for group call E2EE."}}
    end
  end

  defp fetch_required_string(attrs, field) when is_map(attrs) and is_binary(field) do
    case attrs |> Map.get(field) |> normalize_string() do
      nil -> {:error, {:validation, "#{field} is required."}}
      value -> {:ok, value}
    end
  end

  defp fetch_required_non_negative_integer(attrs, field)
       when is_map(attrs) and is_binary(field) do
    case parse_non_negative_integer(Map.get(attrs, field)) do
      nil -> {:error, {:validation, "#{field} must be a non-negative integer."}}
      value -> {:ok, value}
    end
  end

  defp broadcast_call_state(chat_id, %CallSession{} = call) do
    VostokServerWeb.Endpoint.broadcast("call:#{chat_id}", "call:state", %{
      call: present_call(call)
    })
  end

  defp broadcast_participant_state(chat_id, call_id, participants, room) do
    VostokServerWeb.Endpoint.broadcast("call:#{chat_id}", "call:participant_state", %{
      call_id: call_id,
      participants: participants,
      room: room
    })
  end

  defp broadcast_signal(chat_id, signal) do
    VostokServerWeb.Endpoint.broadcast("call:#{chat_id}", "call:signal", %{
      call_id: signal.call_id,
      signal: signal
    })
  end
end
