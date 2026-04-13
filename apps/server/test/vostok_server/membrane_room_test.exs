defmodule VostokServer.Calls.MembraneRoomTest do
  use VostokServer.DataCase, async: false

  alias Membrane.RTC.Engine.Message.EndpointMessage
  alias VostokServer.Calls.MembraneRoom

  setup do
    original_env = Application.get_all_env(:vostok_server)

    on_exit(fn ->
      Application.put_all_env(vostok_server: original_env)
    end)

    :ok
  end

  test "keeps only the configured amount of pending media events per endpoint" do
    Application.put_env(:vostok_server, :call_media_event_queue_limit, 3)
    call_id = Ecto.UUID.generate()
    pid = start_supervised!({MembraneRoom, {call_id, "group"}})

    for index <- 1..5 do
      send(
        pid,
        %EndpointMessage{
          endpoint_id: "device-1",
          endpoint_type: Membrane.RTC.Engine.Endpoint.WebRTC,
          message: {:media_event, "event-#{index}"}
        }
      )
    end

    Process.sleep(30)
    response = MembraneRoom.poll_media_events(call_id, "device-1")

    assert response.media_events == ["event-3", "event-4", "event-5"]

    room_snapshot = MembraneRoom.describe(call_id)
    assert room_snapshot.media_event_stats.received_from_engine == 5
    assert room_snapshot.media_event_stats.truncated == 2
  end

  test "surfaces quality and TURN queue configuration in room state" do
    Application.put_env(:vostok_server, :turn_ports_range_start, 51_000)
    Application.put_env(:vostok_server, :turn_ports_range_end, 51_120)
    Application.put_env(:vostok_server, :call_media_event_queue_limit, 96)
    Application.put_env(:vostok_server, :call_simulcast_enabled, true)
    Application.put_env(:vostok_server, :call_video_tracks_limit, 6)
    Application.put_env(:vostok_server, :call_webrtc_toilet_capacity, 256)

    call_id = Ecto.UUID.generate()
    _pid = start_supervised!({MembraneRoom, {call_id, "group"}})

    snapshot = MembraneRoom.describe(call_id)

    assert snapshot.turn_ports_range == %{start: 51_000, end: 51_120}
    assert snapshot.media_event_queue_limit == 96
    assert snapshot.endpoint_quality.simulcast_enabled == true
    assert snapshot.endpoint_quality.video_tracks_limit == 6
    assert snapshot.endpoint_quality.toilet_capacity == 256
  end
end
