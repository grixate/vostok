defmodule VostokServer.Calls.MembraneRoom do
  @moduledoc """
  Room process that boots a real `Membrane.RTC.Engine` instance per active call.

  The current implementation still keeps participant bookkeeping in-process, but
  the room now boots real `Membrane.RTC.Engine.Endpoint.WebRTC` endpoints for
  each device. The local queue remains in place for custom bridge events that
  are not valid Membrane media events, so the existing call-signal fallback path
  stays usable while the native WebRTC media path comes online.
  """

  use GenServer

  alias Membrane.RTC.Engine
  alias Membrane.RTC.Engine.Endpoint.WebRTC
  alias Membrane.RTC.Engine.Endpoint.WebRTC.MediaEvent
  alias Membrane.RTC.Engine.Message.EndpointCrashed
  alias Membrane.RTC.Engine.Message.EndpointMessage
  alias Membrane.RTC.Engine.Message.EndpointRemoved

  def start_link({call_id, mode}) when is_binary(call_id) and is_binary(mode) do
    GenServer.start_link(__MODULE__, {call_id, mode}, name: via(call_id))
  end

  def describe(call_id) when is_binary(call_id) do
    GenServer.call(via(call_id), :describe)
  catch
    :exit, _reason -> nil
  end

  def join(call_id, participant) when is_binary(call_id) and is_map(participant) do
    GenServer.call(via(call_id), {:join, participant})
  end

  def leave(call_id, device_id) when is_binary(call_id) and is_binary(device_id) do
    GenServer.call(via(call_id), {:leave, device_id})
  end

  def ensure_webrtc_endpoint(call_id, endpoint_id, metadata \\ %{})
      when is_binary(call_id) and is_binary(endpoint_id) and is_map(metadata) do
    GenServer.call(via(call_id), {:ensure_webrtc_endpoint, endpoint_id, metadata})
  end

  def remove_webrtc_endpoint(call_id, endpoint_id)
      when is_binary(call_id) and is_binary(endpoint_id) do
    GenServer.call(via(call_id), {:remove_webrtc_endpoint, endpoint_id})
  catch
    :exit, _reason ->
      %{
        endpoint_id: endpoint_id,
        exists: false,
        pending_media_event_count: 0
      }
  end

  def endpoint_state(call_id, endpoint_id) when is_binary(call_id) and is_binary(endpoint_id) do
    GenServer.call(via(call_id), {:endpoint_state, endpoint_id})
  catch
    :exit, _reason ->
      %{
        endpoint_id: endpoint_id,
        exists: false,
        pending_media_event_count: 0
      }
  end

  def forward_media_event(call_id, endpoint_id, event)
      when is_binary(call_id) and is_binary(endpoint_id) and is_binary(event) do
    GenServer.call(via(call_id), {:forward_media_event, endpoint_id, event})
  catch
    :exit, _reason ->
      %{
        endpoint: %{
          endpoint_id: endpoint_id,
          exists: false,
          pending_media_event_count: 0
        },
        media_events: []
      }
  end

  def poll_media_events(call_id, endpoint_id)
      when is_binary(call_id) and is_binary(endpoint_id) do
    GenServer.call(via(call_id), {:poll_media_events, endpoint_id})
  catch
    :exit, _reason ->
      %{
        endpoint: %{
          endpoint_id: endpoint_id,
          exists: false,
          pending_media_event_count: 0
        },
        media_events: []
      }
  end

  @impl true
  def init({call_id, mode}) do
    {:ok, engine_pid} = Engine.start_link([], [])
    :ok = Engine.register(engine_pid, self())

    {:ok,
     %{
       backend: "membrane_rtc_engine",
       call_id: call_id,
       engine_pid: engine_pid,
       mode: mode,
       participants: %{},
       webrtc_endpoints: %{},
       outbound_media_events: %{}
     }}
  end

  @impl true
  def handle_call(:describe, _from, state) do
    {:reply, present_state(state), state}
  end

  def handle_call({:join, participant}, _from, state) do
    next_state =
      put_in(state, [:participants, participant.device_id], %{
        device_id: participant.device_id,
        status: participant.status,
        track_kind: participant.track_kind
      })

    {:reply, present_state(next_state), next_state}
  end

  def handle_call({:leave, device_id}, _from, state) do
    next_state =
      update_in(state.participants, fn participants ->
        Map.delete(participants, device_id)
      end)

    {:reply, present_state(next_state), next_state}
  end

  def handle_call({:ensure_webrtc_endpoint, endpoint_id, metadata}, _from, state) do
    next_state =
      if Map.has_key?(state.webrtc_endpoints, endpoint_id) do
        state
      else
        endpoint = %WebRTC{
          rtc_engine: state.engine_pid,
          owner: self(),
          ice_name: endpoint_id,
          handshake_opts: [client_mode: false, dtls_srtp: true],
          metadata: metadata
        }

        :ok = Engine.add_endpoint(state.engine_pid, endpoint, id: endpoint_id)

        state
        |> put_in([:webrtc_endpoints, endpoint_id], %{
          endpoint_id: endpoint_id,
          metadata: metadata
        })
        |> put_in([:outbound_media_events, endpoint_id], [])
      end

    {:reply, present_endpoint_state(next_state, endpoint_id), next_state}
  end

  def handle_call({:endpoint_state, endpoint_id}, _from, state) do
    {:reply, present_endpoint_state(state, endpoint_id), state}
  end

  def handle_call({:remove_webrtc_endpoint, endpoint_id}, _from, state) do
    if Map.has_key?(state.webrtc_endpoints, endpoint_id) do
      :ok = Engine.remove_endpoint(state.engine_pid, endpoint_id)
    end

    next_state =
      state
      |> update_in([:webrtc_endpoints], fn endpoints -> Map.delete(endpoints, endpoint_id) end)
      |> update_in([:outbound_media_events], fn events -> Map.delete(events, endpoint_id) end)

    {:reply, present_endpoint_state(next_state, endpoint_id), next_state}
  end

  def handle_call({:forward_media_event, endpoint_id, event}, _from, state) do
    next_state =
      if Map.has_key?(state.webrtc_endpoints, endpoint_id) do
        case MediaEvent.decode(event) do
          {:ok, _decoded_event} ->
            :ok = Engine.message_endpoint(state.engine_pid, endpoint_id, {:media_event, event})
            state

          {:error, :invalid_media_event} ->
            push_outbound_media_event(state, endpoint_id, event)
        end
      else
        state
      end

    {:reply, %{endpoint: present_endpoint_state(next_state, endpoint_id), media_events: []},
     next_state}
  end

  def handle_call({:poll_media_events, endpoint_id}, _from, state) do
    {events, next_state} = pop_media_events(state, endpoint_id)

    {:reply, %{endpoint: present_endpoint_state(next_state, endpoint_id), media_events: events},
     next_state}
  end

  @impl true
  def handle_info(
        %EndpointMessage{endpoint_id: endpoint_id, message: {:media_event, event}},
        state
      ) do
    {:noreply, push_outbound_media_event(state, endpoint_id, event)}
  end

  def handle_info(%EndpointRemoved{endpoint_id: endpoint_id}, state) do
    {:noreply, drop_endpoint(state, endpoint_id)}
  end

  def handle_info(%EndpointCrashed{endpoint_id: endpoint_id}, state) do
    {:noreply, drop_endpoint(state, endpoint_id)}
  end

  def handle_info(_message, state) do
    {:noreply, state}
  end

  @impl true
  def terminate(_reason, state) do
    if is_pid(state.engine_pid) and Process.alive?(state.engine_pid) do
      Engine.terminate(state.engine_pid)
    end

    :ok
  end

  defp via(call_id), do: {:via, Registry, {VostokServer.Calls.RoomRegistry, call_id}}

  defp present_state(state) do
    endpoints =
      state.engine_pid
      |> Engine.get_endpoints()
      |> Enum.to_list()

    tracks =
      state.engine_pid
      |> Engine.get_tracks()
      |> Enum.to_list()

    %{
      backend: state.backend,
      call_id: state.call_id,
      endpoint_count: length(endpoints),
      engine_pid: inspect(state.engine_pid),
      forwarded_track_count: Engine.get_num_forwarded_tracks(state.engine_pid),
      mode: state.mode,
      participant_count: map_size(state.participants),
      active_device_ids: state.participants |> Map.keys() |> Enum.sort(),
      track_count: length(tracks),
      webrtc_endpoint_count: map_size(state.webrtc_endpoints)
    }
  end

  defp present_endpoint_state(state, endpoint_id) do
    pending_events = Map.get(state.outbound_media_events, endpoint_id, [])

    %{
      endpoint_id: endpoint_id,
      exists: Map.has_key?(state.webrtc_endpoints, endpoint_id),
      pending_media_event_count: length(pending_events)
    }
  end

  defp pop_media_events(state, endpoint_id) do
    events = Map.get(state.outbound_media_events, endpoint_id, [])
    next_state = put_in(state.outbound_media_events[endpoint_id], [])
    {events, next_state}
  end

  defp push_outbound_media_event(state, endpoint_id, event) do
    update_in(state.outbound_media_events, fn events ->
      Map.update(events, endpoint_id, [event], fn current ->
        Enum.take(current ++ [event], -20)
      end)
    end)
  end

  defp drop_endpoint(state, endpoint_id) do
    state
    |> update_in([:webrtc_endpoints], fn endpoints -> Map.delete(endpoints, endpoint_id) end)
    |> update_in([:outbound_media_events], fn events -> Map.delete(events, endpoint_id) end)
  end
end
