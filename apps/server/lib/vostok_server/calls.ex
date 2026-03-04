defmodule VostokServer.Calls do
  @moduledoc """
  Stage 7 call session scaffold.
  """

  import Ecto.Query

  alias VostokServer.Calls.{
    CallParticipant,
    CallSession,
    CallSignal,
    MembraneRoom,
    RoomSupervisor
  }

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
         {:ok, _room, _pid} <- RoomSupervisor.ensure_room(call.id, call.mode),
         {:ok, participant} <- upsert_participant(call, user_id, current_device_id, track_kind) do
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
      bridge_signal_to_webrtc_endpoint(call, signal)
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

  defp upsert_participant(call, user_id, current_device_id, track_kind) do
    now = DateTime.utc_now()

    case Repo.get_by(CallParticipant, call_id: call.id, device_id: current_device_id) do
      %CallParticipant{} = participant ->
        participant
        |> CallParticipant.changeset(%{
          user_id: user_id,
          status: "joined",
          track_kind: track_kind,
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

  defp bridge_signal_to_webrtc_endpoint(%CallSession{} = call, %CallSignal{} = signal) do
    signal
    |> signal_bridge_targets(call)
    |> Enum.each(fn endpoint_id ->
      ensure_bridge_endpoint(call, endpoint_id, %{source: "signal_bridge"})
      MembraneRoom.forward_media_event(call.id, endpoint_id, encode_signal_bridge_event(signal))
    end)
  end

  defp signal_bridge_targets(
         %CallSignal{
           from_device_id: from_device_id,
           target_device_id: target_device_id
         },
         %CallSession{} = call
       ) do
    case target_device_id do
      nil ->
        joined_targets = list_joined_participant_device_ids(call.id, from_device_id)
        if joined_targets == [], do: [from_device_id], else: joined_targets

      endpoint_id ->
        [endpoint_id]
    end
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

  defp list_joined_participant_device_ids(call_id, excluded_device_id) do
    from(participant in CallParticipant,
      where:
        participant.call_id == ^call_id and participant.status == "joined" and
          participant.device_id != ^excluded_device_id,
      order_by: [asc: participant.inserted_at],
      select: participant.device_id
    )
    |> Repo.all()
  end

  defp encode_signal_bridge_event(%CallSignal{} = signal) do
    Jason.encode!(%{
      kind: "call_signal_bridge",
      signal: present_signal(signal)
    })
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
