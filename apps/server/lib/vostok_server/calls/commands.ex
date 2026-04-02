defmodule VostokServer.Calls.Commands do
  @moduledoc false

  import Ecto.Query

  import VostokServer.Calls.Params,
    only: [
      normalize_call_key_distribution_attrs: 1,
      normalize_join_e2ee: 4,
      normalize_media_event: 1,
      normalize_media_mode: 2,
      normalize_mode: 1,
      normalize_room_media_mode: 1,
      normalize_signal_attrs: 3,
      normalize_string: 1,
      normalize_track_kind: 2,
      normalize_user_id_list: 1,
      resolve_call_key_recipients: 3
    ]

  import VostokServer.Calls.Presenter,
    only: [
      current_room_state: 1,
      list_presented_call_room_members: 1,
      list_presented_participants: 1,
      present_call: 1,
      present_call_key_distribution: 1,
      present_call_room: 1,
      present_call_room_for_call: 1,
      present_participant: 1,
      present_signal: 1
    ]

  alias Ecto.Multi

  alias VostokServer.Calls.{
    Access,
    CallKeyDistribution,
    CallRoom,
    CallRoomMember,
    CallSession,
    MembraneRoom,
    Mutations,
    Notifier,
    Runtime,
    RoomSupervisor
  }

  alias VostokServer.Identity.User
  alias VostokServer.Messaging
  alias VostokServer.Repo

  def create_call_room(user_id, attrs) when is_binary(user_id) and is_map(attrs) do
    participant_user_ids =
      attrs
      |> Map.get("participant_user_ids", [])
      |> normalize_user_id_list()
      |> Enum.reject(&(&1 == user_id))

    title =
      attrs
      |> Map.get("title")
      |> normalize_string()

    requested_user_ids = Enum.uniq([user_id | participant_user_ids])

    users =
      from(user in User, where: user.id in ^requested_user_ids)
      |> Repo.all()

    user_ids = MapSet.new(Enum.map(users, & &1.id))

    if not Enum.all?(requested_user_ids, &MapSet.member?(user_ids, &1)) do
      {:error, {:validation, "participant_user_ids includes an unknown user."}}
    else
      now = DateTime.utc_now()

      resolved_title =
        title ||
          users
          |> Enum.reject(&(&1.id == user_id))
          |> Enum.map(&String.trim(&1.display_name || &1.username))
          |> Enum.reject(&(&1 == ""))
          |> Enum.take(4)
          |> Enum.join(", ")
          |> case do
            "" -> "Ad-hoc call"
            value -> value
          end

      Multi.new()
      |> Multi.insert(
        :room,
        CallRoom.changeset(%CallRoom{}, %{
          title: resolved_title,
          created_by_user_id: user_id,
          expires_at: DateTime.add(now, 86_400, :second)
        })
      )
      |> Multi.run(:members, fn repo, %{room: room} ->
        requested_user_ids
        |> Enum.reduce_while({:ok, []}, fn member_user_id, {:ok, inserted} ->
          role = if member_user_id == user_id, do: "owner", else: "member"

          room
          |> Ecto.build_assoc(:members, user_id: member_user_id)
          |> CallRoomMember.changeset(%{role: role, joined_at: now})
          |> repo.insert()
          |> case do
            {:ok, member} ->
              {:cont, {:ok, [member | inserted]}}

            {:error, changeset} ->
              {:halt, {:error, {:validation, format_changeset_error(changeset)}}}
          end
        end)
      end)
      |> Repo.transaction()
      |> case do
        {:ok, %{room: room}} ->
          {:ok,
           %{room: present_call_room(room), members: list_presented_call_room_members(room.id)}}

        {:error, _step, reason, _changes} ->
          {:error, reason}
      end
    end
  end

  def start_call(chat_id, user_id, current_device_id, attrs)
      when is_binary(chat_id) and is_binary(user_id) and is_binary(current_device_id) and
             is_map(attrs) do
    with {:ok, _membership} <- Messaging.ensure_membership(chat_id, user_id),
         {:ok, mode} <- normalize_mode(attrs),
         {:ok, media_mode} <- normalize_media_mode(mode, attrs) do
      case Access.active_call_record("chat", chat_id) do
        %CallSession{} = call ->
          Runtime.maybe_ensure_room(call)
          Notifier.broadcast_call_state(call)
          {:ok, present_call(call)}

        nil ->
          %CallSession{}
          |> CallSession.changeset(%{
            chat_id: chat_id,
            scope_type: "chat",
            scope_id: chat_id,
            started_by_device_id: current_device_id,
            mode: mode,
            media_mode: media_mode,
            status: "ringing",
            started_at: DateTime.utc_now()
          })
          |> Repo.insert()
          |> case do
            {:ok, call} ->
              Notifier.broadcast_call_state(call)
              Notifier.schedule_ring_timeout(call.id)
              {:ok, present_call(call)}

            {:error, changeset} ->
              {:error, {:validation, format_changeset_error(changeset)}}
          end
      end
    end
  end

  def start_call_room(room_id, user_id, current_device_id, attrs)
      when is_binary(room_id) and is_binary(user_id) and is_binary(current_device_id) and
             is_map(attrs) do
    with {:ok, _membership} <- Access.ensure_call_room_membership(room_id, user_id),
         {:ok, media_mode} <- normalize_room_media_mode(attrs) do
      case Access.active_call_record("call_room", room_id) do
        %CallSession{} = call ->
          Runtime.maybe_ensure_room(call)
          Notifier.broadcast_call_state(call)
          {:ok, present_call(call)}

        nil ->
          %CallSession{}
          |> CallSession.changeset(%{
            call_room_id: room_id,
            scope_type: "call_room",
            scope_id: room_id,
            started_by_device_id: current_device_id,
            mode: "group",
            media_mode: media_mode,
            status: "ringing",
            started_at: DateTime.utc_now()
          })
          |> Repo.insert()
          |> case do
            {:ok, call} ->
              Notifier.broadcast_call_state(call)
              Notifier.schedule_ring_timeout(call.id)
              {:ok, present_call(call)}

            {:error, changeset} ->
              {:error, {:validation, format_changeset_error(changeset)}}
          end
      end
    end
  end

  def accept_call(call_id, user_id)
      when is_binary(call_id) and is_binary(user_id) do
    with %CallSession{status: "ringing"} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Access.ensure_call_access(call, user_id) do
      call
      |> CallSession.changeset(%{status: "active"})
      |> Repo.update()
      |> case do
        {:ok, updated_call} ->
          Runtime.maybe_ensure_room(updated_call)
          Notifier.broadcast_call_state(updated_call)

          Notifier.emit_call_history_message(
            updated_call,
            "#{String.capitalize(updated_call.mode)} call started"
          )

          {:ok, present_call(updated_call)}

        {:error, changeset} ->
          {:error, {:validation, format_changeset_error(changeset)}}
      end
    else
      %CallSession{status: status} ->
        {:error, {:validation, "Call is #{status}, cannot accept."}}

      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def decline_call(call_id, user_id)
      when is_binary(call_id) and is_binary(user_id) do
    with %CallSession{status: "ringing"} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Access.ensure_call_access(call, user_id) do
      call
      |> CallSession.changeset(%{
        status: "ended",
        ended_at: DateTime.utc_now(),
        end_reason: "declined"
      })
      |> Repo.update()
      |> case do
        {:ok, updated_call} ->
          Notifier.broadcast_call_state(updated_call)
          Notifier.emit_call_history_message(updated_call, "Declined call")
          {:ok, present_call(updated_call)}

        {:error, changeset} ->
          {:error, {:validation, format_changeset_error(changeset)}}
      end
    else
      %CallSession{} ->
        {:error, {:validation, "Call is no longer ringing."}}

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
         {:ok, _membership} <- Access.ensure_call_access(call, user_id),
         :ok <- Access.ensure_active(call),
         {:ok, track_kind} <- normalize_track_kind(call, attrs),
         {:ok, e2ee_attrs} <-
           normalize_join_e2ee(
             call,
             attrs,
             current_device_id,
             &Access.ensure_group_join_key_available/3
           ),
         {:ok, _room, _pid} <- RoomSupervisor.ensure_room(call.id, call.mode),
         {:ok, participant} <-
           Mutations.upsert_participant(
             call,
             user_id,
             current_device_id,
             track_kind,
             e2ee_attrs,
             &format_changeset_error/1
           ) do
      Runtime.ensure_bridge_endpoint(call, current_device_id, %{
        user_id: user_id,
        track_kind: track_kind,
        source: "join_call"
      })

      room = MembraneRoom.join(call.id, present_participant(participant))
      participants = list_presented_participants(call.id)
      Notifier.broadcast_participant_state(call, participants, room)

      {:ok,
       %{
         call: present_call(call),
         call_room: present_call_room_for_call(call),
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
         {:ok, _membership} <- Access.ensure_call_access(call, user_id),
         {:ok, participant} <-
           Mutations.mark_participant_left(
             call.id,
             current_device_id,
             &format_changeset_error/1
           ) do
      room =
        case current_room_state(call) do
          nil ->
            nil

          _room ->
            MembraneRoom.remove_webrtc_endpoint(call.id, current_device_id)
            MembraneRoom.leave(call.id, current_device_id)
        end

      participants = list_presented_participants(call.id)
      Notifier.broadcast_participant_state(call, participants, room)

      {:ok,
       %{
         call: present_call(call),
         call_room: present_call_room_for_call(call),
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
         {:ok, _membership} <- Access.ensure_call_access(call, user_id) do
      completion_message = Notifier.call_completion_message(call)
      end_reason = if call.status == "ringing", do: "cancelled", else: "normal"

      call
      |> CallSession.changeset(%{
        status: "ended",
        ended_at: DateTime.utc_now(),
        end_reason: end_reason
      })
      |> Repo.update()
      |> case do
        {:ok, updated} ->
          Mutations.mark_all_participants_left(updated.id)
          RoomSupervisor.stop_room(updated.id)

          Notifier.broadcast_participant_state(
            updated,
            list_presented_participants(updated.id),
            nil
          )

          Notifier.broadcast_call_state(updated)
          Notifier.emit_call_history_message(updated, completion_message)
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

  def rotate_call_keys(call_id, user_id, current_device_id, attrs)
      when is_binary(call_id) and is_binary(user_id) and is_binary(current_device_id) and
             is_map(attrs) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Access.ensure_call_access(call, user_id),
         :ok <- Access.ensure_active(call),
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
          {:ok,
           %{call: present_call(call), call_room: present_call_room_for_call(call), keys: keys}}

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
         {:ok, _membership} <- Access.ensure_call_access(call, user_id),
         :ok <- Access.ensure_active(call),
         {:ok, signal_attrs} <- normalize_signal_attrs(call.id, current_device_id, attrs),
         {:ok, signal} <- Mutations.insert_signal(signal_attrs, &format_changeset_error/1) do
      presented_signal = present_signal(signal)
      Runtime.maybe_ensure_room(call)
      Notifier.broadcast_signal(call, presented_signal)

      {:ok,
       %{
         call: present_call(call),
         call_room: present_call_room_for_call(call),
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
         {:ok, _membership} <- Access.ensure_call_access(call, user_id),
         :ok <- Access.ensure_active(call),
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
         call_room: present_call_room_for_call(call),
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
         {:ok, _membership} <- Access.ensure_call_access(call, user_id),
         {:ok, event} <- normalize_media_event(attrs) do
      result = MembraneRoom.forward_media_event(call.id, current_device_id, event)

      {:ok,
       %{
         call: present_call(call),
         call_room: present_call_room_for_call(call),
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

  defp format_changeset_error(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
    |> Enum.map(fn {field, [message | _]} -> "#{field} #{message}" end)
    |> List.first()
    |> Kernel.||("The call session could not be saved.")
  end
end
