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
  alias Membrane.RTC.Engine.Endpoint.WebRTC.SimulcastConfig
  alias Membrane.RTC.Engine.Message.EndpointCrashed
  alias Membrane.RTC.Engine.Message.EndpointMessage
  alias Membrane.RTC.Engine.Message.EndpointRemoved

  alias VostokServer.Calls.CallSession
  alias VostokServer.Repo
  alias VostokServerWeb.Endpoint

  @log_file "/tmp/vostok-membrane.log"
  @default_media_event_queue_limit 64
  @default_turn_ports_range {50_000, 50_050}

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
    endpoint_quality = endpoint_quality_options()

    {:ok,
     %{
       backend: "membrane_rtc_engine",
       call_id: call_id,
       engine_pid: engine_pid,
       mode: mode,
       realtime_topic: call_topic(call_id),
       participants: %{},
       webrtc_endpoints: %{},
       outbound_media_events: %{},
       turn_ports_range: turn_ports_range(),
       media_event_queue_limit: media_event_queue_limit(),
       media_event_stats: %{
         forwarded: 0,
         invalid: 0,
         dropped_missing_endpoint: 0,
         received_from_engine: 0,
         polled: 0,
         truncated: 0
       },
       endpoint_quality: endpoint_quality
     }}
  end

  @impl true
  def handle_call(:describe, _from, state) do
    state = ensure_runtime_defaults(state)
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
    state = ensure_runtime_defaults(state)

    next_state =
      if Map.has_key?(state.webrtc_endpoints, endpoint_id) do
        mlog("ENDPOINT already exists: #{endpoint_id}")
        state
      else
        mlog("CREATING ENDPOINT: #{endpoint_id}")
        turn_options = integrated_turn_options()
        mlog("TURN OPTIONS for #{endpoint_id}: #{inspect(turn_options)}")
        endpoint_quality = state.endpoint_quality

        endpoint =
          struct(WebRTC, %{
            rtc_engine: state.engine_pid,
            owner: self(),
            ice_name: endpoint_id,
            handshake_opts: [client_mode: false, dtls_srtp: true],
            integrated_turn_options: turn_options,
            simulcast_config: %SimulcastConfig{
              enabled: endpoint_quality.simulcast_enabled,
              initial_target_variant: &__MODULE__.initial_track_variant/1
            },
            video_tracks_limit: endpoint_quality.video_tracks_limit,
            toilet_capacity: endpoint_quality.toilet_capacity,
            filter_codecs: &__MODULE__.balanced_codec_filter/1,
            metadata: metadata
          })

        try do
          :ok = Engine.add_endpoint(state.engine_pid, endpoint, id: endpoint_id)

          state
          |> put_in([:webrtc_endpoints, endpoint_id], %{
            endpoint_id: endpoint_id,
            metadata: metadata
          })
          |> put_in([:outbound_media_events, endpoint_id], [])
        catch
          kind, reason ->
            mlog("FAILED to add endpoint #{endpoint_id}: #{kind} #{inspect(reason)}")
            state
        end
      end

    {:reply, present_endpoint_state(next_state, endpoint_id), next_state}
  end

  def handle_call({:endpoint_state, endpoint_id}, _from, state) do
    {:reply, present_endpoint_state(state, endpoint_id), state}
  end

  def handle_call({:remove_webrtc_endpoint, endpoint_id}, _from, state) do
    state = ensure_runtime_defaults(state)

    if Map.has_key?(state.webrtc_endpoints, endpoint_id) do
      try do
        :ok = Engine.remove_endpoint(state.engine_pid, endpoint_id)
      catch
        kind, reason ->
          mlog("FAILED to remove endpoint #{endpoint_id}: #{kind} #{inspect(reason)}")
      end
    end

    next_state =
      state
      |> update_in([:webrtc_endpoints], fn endpoints -> Map.delete(endpoints, endpoint_id) end)
      |> update_in([:outbound_media_events], fn events -> Map.delete(events, endpoint_id) end)

    {:reply, present_endpoint_state(next_state, endpoint_id), next_state}
  end

  def handle_call({:forward_media_event, endpoint_id, event}, _from, state) do
    state = ensure_runtime_defaults(state)

    next_state =
      if Map.has_key?(state.webrtc_endpoints, endpoint_id) do
        case MediaEvent.decode(event) do
          {:ok, _decoded_event} ->
            mlog("FORWARD media event for #{endpoint_id}: #{String.slice(event, 0, 200)}")
            try do
              :ok = Engine.message_endpoint(state.engine_pid, endpoint_id, {:media_event, event})
              bump_media_event_stat(state, :forwarded)
            catch
              kind, reason ->
                mlog("FAILED to forward media event for #{endpoint_id}: #{kind} #{inspect(reason)}")
                bump_media_event_stat(state, :dropped_missing_endpoint)
            end

          {:error, :invalid_media_event} ->
            mlog("REJECTED invalid media event for #{endpoint_id}: #{String.slice(event, 0, 200)}")
            bump_media_event_stat(state, :invalid)
        end
      else
        mlog("DROPPED media event — endpoint #{endpoint_id} not found")
        bump_media_event_stat(state, :dropped_missing_endpoint)
      end

    {:reply, %{endpoint: present_endpoint_state(next_state, endpoint_id), media_events: []},
     next_state}
  end

  def handle_call({:poll_media_events, endpoint_id}, _from, state) do
    state = ensure_runtime_defaults(state)
    {events, next_state} = pop_media_events(state, endpoint_id)
    next_state = increment_media_event_stat(next_state, :polled, length(events))

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

    next_state =
      state
      |> bump_media_event_stat(:received_from_engine)
      |> push_outbound_media_event(endpoint_id, event)
      |> maybe_broadcast_media_event(endpoint_id, event)

    {:noreply, next_state}
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
    state = ensure_runtime_defaults(state)

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
      webrtc_endpoint_count: map_size(state.webrtc_endpoints),
      turn_ports_range: present_turn_ports_range(state.turn_ports_range),
      media_event_queue_limit: state.media_event_queue_limit,
      media_event_stats: state.media_event_stats,
      endpoint_quality: state.endpoint_quality
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
    queue_limit = state |> Map.get(:media_event_queue_limit, @default_media_event_queue_limit) |> max(1)
    existing_events = Map.get(state.outbound_media_events, endpoint_id, [])
    truncated? = length(existing_events) >= queue_limit

    updated_state =
      update_in(state.outbound_media_events, fn events ->
        Map.update(events, endpoint_id, [event], fn current ->
          Enum.take(current ++ [event], -queue_limit)
        end)
      end)

    if truncated? do
      bump_media_event_stat(updated_state, :truncated)
    else
      updated_state
    end
  end

  defp drop_endpoint(state, endpoint_id) do
    state
    |> update_in([:webrtc_endpoints], fn endpoints -> Map.delete(endpoints, endpoint_id) end)
    |> update_in([:outbound_media_events], fn events -> Map.delete(events, endpoint_id) end)
  end

  defp maybe_broadcast_media_event(%{realtime_topic: nil} = state, _endpoint_id, _event), do: state

  defp maybe_broadcast_media_event(%{realtime_topic: topic, call_id: call_id} = state, endpoint_id, event) do
    Endpoint.broadcast(topic, "call:media_event", %{
      call_id: call_id,
      target_device_id: endpoint_id,
      event: event
    })

    state
  end

  defp integrated_turn_options do
    explicit_bind_ip =
      Application.get_env(:vostok_server, :turn_bind_ip) ||
        parse_ip(System.get_env("VOSTOK_TURN_BIND_IP"))

    explicit_public_ip =
      Application.get_env(:vostok_server, :turn_public_ip) ||
        parse_ip(System.get_env("VOSTOK_TURN_PUBLIC_IP"))

    inferred_public_ip =
      explicit_public_ip ||
        infer_turn_public_ip()

    bind_ip =
      explicit_bind_ip ||
        default_turn_bind_ip(inferred_public_ip)

    mock_ip =
      inferred_public_ip ||
        default_turn_public_ip(bind_ip)

    [
      ip: bind_ip,
      mock_ip: mock_ip,
      ports_range: turn_ports_range()
    ]
  end

  defp default_turn_bind_ip(public_ip) do
    if endpoint_loopback_only?() and is_nil(public_ip) do
      {127, 0, 0, 1}
    else
      {0, 0, 0, 0}
    end
  end

  defp default_turn_public_ip(bind_ip), do: infer_turn_public_ip() || bind_ip

  defp infer_turn_public_ip do
    uri_host_ip() ||
      parse_ip(System.get_env("PHX_HOST")) ||
      first_non_loopback_ipv4()
  end

  defp endpoint_loopback_only? do
    VostokServerWeb.Endpoint.config(:http)
    |> Keyword.get(:ip)
    |> loopback_ip?()
  rescue
    _ -> false
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
          {198, second, _, _} when second in 18..19 -> false
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

  def initial_track_variant(_track), do: :high

  def balanced_codec_filter(%{name: "opus"}), do: true
  def balanced_codec_filter(%{name: "VP8"}), do: true

  def balanced_codec_filter(%{name: "H264", format_parms: fmtp}) do
    case fmtp do
      %{profile_level_id: profile_level_id} when profile_level_id in [0x42E01F, 0x42001F, 0x42E01E] ->
        true

      _ ->
        false
    end
  end

  def balanced_codec_filter(_encoding), do: false

  defp endpoint_quality_options do
    %{
      simulcast_enabled: Application.get_env(:vostok_server, :call_simulcast_enabled, true),
      video_tracks_limit: Application.get_env(:vostok_server, :call_video_tracks_limit, 8),
      toilet_capacity: Application.get_env(:vostok_server, :call_webrtc_toilet_capacity, 320)
    }
  end

  defp media_event_queue_limit do
    Application.get_env(
      :vostok_server,
      :call_media_event_queue_limit,
      @default_media_event_queue_limit
    )
    |> normalize_positive_integer(@default_media_event_queue_limit)
  end

  defp turn_ports_range do
    start_port =
      Application.get_env(:vostok_server, :turn_ports_range_start, elem(@default_turn_ports_range, 0))
      |> normalize_positive_integer(elem(@default_turn_ports_range, 0))

    end_port =
      Application.get_env(:vostok_server, :turn_ports_range_end, elem(@default_turn_ports_range, 1))
      |> normalize_positive_integer(elem(@default_turn_ports_range, 1))

    if end_port < start_port do
      @default_turn_ports_range
    else
      {start_port, end_port}
    end
  end

  defp normalize_positive_integer(value, _fallback) when is_integer(value) and value > 0, do: value
  defp normalize_positive_integer(_value, fallback), do: fallback

  defp bump_media_event_stat(state, key), do: increment_media_event_stat(state, key, 1)

  defp increment_media_event_stat(state, key, amount) do
    stats = Map.get(state, :media_event_stats, default_media_event_stats())
    updated_stats = Map.update(stats, key, amount, &(&1 + amount))
    Map.put(state, :media_event_stats, updated_stats)
  end

  defp default_media_event_stats do
    %{
      forwarded: 0,
      invalid: 0,
      dropped_missing_endpoint: 0,
      received_from_engine: 0,
      polled: 0,
      truncated: 0
    }
  end

  defp ensure_runtime_defaults(state) do
    endpoint_quality =
      case Map.fetch(state, :endpoint_quality) do
        {:ok, quality} when is_map(quality) -> quality
        _other -> endpoint_quality_options()
      end

    queue_limit =
      case Map.fetch(state, :media_event_queue_limit) do
        {:ok, value} when is_integer(value) and value > 0 -> value
        _other -> media_event_queue_limit()
      end

    turn_range =
      case Map.fetch(state, :turn_ports_range) do
        {:ok, {start_port, end_port}} when is_integer(start_port) and is_integer(end_port) ->
          {start_port, end_port}

        _other ->
          turn_ports_range()
      end

    state
    |> Map.put(:endpoint_quality, endpoint_quality)
    |> Map.put(:media_event_queue_limit, queue_limit)
    |> Map.put(:media_event_stats, Map.get(state, :media_event_stats, default_media_event_stats()))
    |> Map.put(:turn_ports_range, turn_range)
  end

  defp present_turn_ports_range({start_port, end_port})
       when is_integer(start_port) and is_integer(end_port) do
    %{
      start: start_port,
      end: end_port
    }
  end

  defp present_turn_ports_range(_range) do
    %{
      start: elem(@default_turn_ports_range, 0),
      end: elem(@default_turn_ports_range, 1)
    }
  end

  defp loopback_ip?({127, _, _, _}), do: true
  defp loopback_ip?({0, 0, 0, 0, 0, 0, 0, 1}), do: true
  defp loopback_ip?(_other), do: false

  defp call_topic(call_id) when is_binary(call_id) do
    case Repo.get(CallSession, call_id) do
      %CallSession{scope_type: "chat", chat_id: chat_id} when is_binary(chat_id) ->
        "call:#{chat_id}"

      %CallSession{scope_type: "call_room", call_room_id: room_id} when is_binary(room_id) ->
        "call-room:#{room_id}"

      _other ->
        nil
    end
  end
end
