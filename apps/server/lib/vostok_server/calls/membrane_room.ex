defmodule VostokServer.Calls.MembraneRoom do
  @moduledoc """
  Room process that boots a real `Membrane.RTC.Engine` instance per active call.

  The room keeps participant bookkeeping in-process and boots real
  `Membrane.RTC.Engine.Endpoint.WebRTC` endpoints for each joined device.
  Media event polling now mirrors only protocol-native Membrane events.
  """

  use GenServer
  require Logger

  alias Membrane.RTC.Engine
  alias Membrane.RTC.Engine.Endpoint.WebRTC
  alias Membrane.RTC.Engine.Endpoint.WebRTC.MediaEvent
  alias Membrane.RTC.Engine.Message.EndpointCrashed
  alias Membrane.RTC.Engine.Message.EndpointMessage
  alias Membrane.RTC.Engine.Message.EndpointRemoved

  @log_file "/tmp/vostok-membrane.log"

  defp mlog(msg) do
    line = "[#{DateTime.utc_now()}] #{msg}\n"
    File.write(@log_file, line, [:append])
  end

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
        mlog("ENDPOINT already exists: #{endpoint_id}")
        state
      else
        mlog("CREATING ENDPOINT: #{endpoint_id}")
        endpoint = %WebRTC{
          rtc_engine: state.engine_pid,
          owner: self(),
          ice_name: endpoint_id,
          handshake_opts: [client_mode: false, dtls_srtp: true],
          integrated_turn_options: integrated_turn_options(),
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
            mlog("FORWARD media event for #{endpoint_id}: #{String.slice(event, 0, 200)}")
            :ok = Engine.message_endpoint(state.engine_pid, endpoint_id, {:media_event, event})
            state

          {:error, :invalid_media_event} ->
            mlog("REJECTED invalid media event for #{endpoint_id}: #{String.slice(event, 0, 200)}")
            state
        end
      else
        mlog("DROPPED media event — endpoint #{endpoint_id} not found")
        state
      end

    {:reply, %{endpoint: present_endpoint_state(next_state, endpoint_id), media_events: []},
     next_state}
  end

  def handle_call({:poll_media_events, endpoint_id}, _from, state) do
    {events, next_state} = pop_media_events(state, endpoint_id)

    if length(events) > 0 do
      mlog("POLL returning #{length(events)} event(s) for #{endpoint_id}")
    end

    {:reply, %{endpoint: present_endpoint_state(next_state, endpoint_id), media_events: events},
     next_state}
  end

  @impl true
  def handle_info(
        %EndpointMessage{endpoint_id: endpoint_id, message: {:media_event, event}},
        state
      ) do
    mlog("ENGINE EVENT for #{endpoint_id}: #{String.slice(to_string(event), 0, 200)}")
    {:noreply, push_outbound_media_event(state, endpoint_id, event)}
  end

  def handle_info(%EndpointCrashed{endpoint_id: endpoint_id, reason: reason}, state) do
    mlog("ENDPOINT CRASHED: #{endpoint_id} reason: #{inspect(reason)}")
    {:noreply, drop_endpoint(state, endpoint_id)}
  end

  def handle_info(%EndpointRemoved{endpoint_id: endpoint_id}, state) do
    mlog("ENDPOINT REMOVED: #{endpoint_id}")
    {:noreply, drop_endpoint(state, endpoint_id)}
  end

  def handle_info(unhandled, state) do
    mlog("UNHANDLED: #{inspect(unhandled, limit: 300)}")
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

  defp integrated_turn_options do
    bind_ip =
      Application.get_env(:vostok_server, :turn_bind_ip) ||
        parse_ip(System.get_env("VOSTOK_TURN_BIND_IP")) ||
        {0, 0, 0, 0}

    mock_ip =
      Application.get_env(:vostok_server, :turn_public_ip) ||
        parse_ip(System.get_env("VOSTOK_TURN_PUBLIC_IP")) ||
        infer_turn_public_ip()

    [
      ip: bind_ip,
      mock_ip: mock_ip || bind_ip,
      ports_range: {50_000, 50_050}
    ]
  end

  defp infer_turn_public_ip do
    uri_host_ip() ||
      parse_ip(System.get_env("PHX_HOST")) ||
      first_non_loopback_ipv4()
  end

  defp uri_host_ip do
    Application.get_env(:vostok_server, :public_turn_uris, [])
    |> List.wrap()
    |> Enum.find_value(fn uri ->
      case URI.parse(uri).host do
        nil -> nil
        host -> parse_ip(host)
      end
    end)
  end

  defp parse_ip(nil), do: nil

  defp parse_ip(host) when is_binary(host) do
    case :inet.parse_address(String.to_charlist(host)) do
      {:ok, {127, 0, 0, 1}} -> nil
      {:ok, {0, 0, 0, 0}} -> nil
      {:ok, ip} -> ip
      {:error, _reason} -> nil
    end
  end

  defp first_non_loopback_ipv4 do
    with {:ok, ifaddrs} <- :inet.getifaddrs() do
      ifaddrs
      |> Enum.find_value(fn {_name, attrs} ->
        attrs
        |> Keyword.get_values(:addr)
        |> Enum.find(fn
          {127, _, _, _} -> false
          {169, 254, _, _} -> false
          {a, b, c, d} when is_integer(a) and is_integer(b) and is_integer(c) and is_integer(d) ->
            true
          _other ->
            false
        end)
      end)
    else
      _ -> nil
    end
  end
end
