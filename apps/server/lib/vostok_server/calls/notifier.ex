defmodule VostokServer.Calls.Notifier do
  @moduledoc false

  import Ecto.Query

  import VostokServer.Calls.Presenter, only: [present_call: 1]

  alias VostokServer.Calls.{CallParticipant, CallSession}
  alias VostokServer.Messaging
  alias VostokServer.Repo
  alias VostokServerWeb.Endpoint

  def schedule_ring_timeout(call_id) when is_binary(call_id) do
    Task.start(fn ->
      Process.sleep(30_000)

      case Repo.get(CallSession, call_id) do
        %CallSession{status: "ringing"} = call ->
          call
          |> CallSession.changeset(%{
            status: "ended",
            ended_at: DateTime.utc_now(),
            end_reason: "missed"
          })
          |> Repo.update()
          |> case do
            {:ok, ended} ->
              broadcast_call_state(ended)
              emit_call_history_message(ended, "Missed call")

            _ ->
              :ok
          end

        _ ->
          :ok
      end
    end)
  end

  def emit_call_history_message(%CallSession{} = call, text) when is_binary(text) do
    if call.scope_type == "chat" and is_binary(call.chat_id) do
      _ = Messaging.create_system_message(call.chat_id, call.started_by_device_id, text)
    end

    :ok
  end

  def call_completion_message(%CallSession{} = call) do
    if remote_participant_joined?(call.id, call.started_by_device_id) do
      "#{String.capitalize(call.mode)} call ended"
    else
      "Missed #{call.mode} call"
    end
  end

  def broadcast_call_state(%CallSession{} = call) do
    Endpoint.broadcast(topic_for_call(call), "call:state", %{call: present_call(call)})
  end

  def broadcast_participant_state(%CallSession{} = call, participants, room) do
    Endpoint.broadcast(topic_for_call(call), "call:participant_state", %{
      call_id: call.id,
      participants: participants,
      room: room
    })
  end

  def broadcast_signal(%CallSession{} = call, signal) do
    Endpoint.broadcast(topic_for_call(call), "call:signal", %{
      call_id: signal.call_id,
      signal: signal
    })
  end

  defp remote_participant_joined?(call_id, started_by_device_id) do
    from(participant in CallParticipant,
      where: participant.call_id == ^call_id and participant.device_id != ^started_by_device_id,
      select: count(participant.id)
    )
    |> Repo.one()
    |> Kernel.>(0)
  end

  defp topic_for_call(%CallSession{scope_type: "chat", chat_id: chat_id}), do: "call:#{chat_id}"

  defp topic_for_call(%CallSession{scope_type: "call_room", call_room_id: room_id}),
    do: "call-room:#{room_id}"
end
