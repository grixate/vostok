defmodule VostokServer.Calls.Runtime do
  @moduledoc false

  alias VostokServer.Calls.{CallSession, MembraneRoom, RoomSupervisor}

  def maybe_ensure_room(%CallSession{status: "active"} = call) do
    case RoomSupervisor.ensure_room(call.id, call.mode) do
      {:ok, _room, _pid} -> :ok
      {:error, _reason} -> :ok
    end
  end

  def maybe_ensure_room(_call), do: :ok

  def ensure_bridge_endpoint(%CallSession{} = call, endpoint_id, metadata)
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
end
