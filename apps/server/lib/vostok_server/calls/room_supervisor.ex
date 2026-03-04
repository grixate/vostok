defmodule VostokServer.Calls.RoomSupervisor do
  @moduledoc """
  Supervises per-call Membrane room processes.
  """

  use DynamicSupervisor

  alias VostokServer.Calls.MembraneRoom

  def start_link(_arg) do
    DynamicSupervisor.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  def ensure_room(call_id, mode) when is_binary(call_id) and is_binary(mode) do
    case Registry.lookup(VostokServer.Calls.RoomRegistry, call_id) do
      [{pid, _value}] ->
        {:ok, MembraneRoom.describe(call_id), pid}

      [] ->
        child_spec = {MembraneRoom, {call_id, mode}}

        case DynamicSupervisor.start_child(__MODULE__, child_spec) do
          {:ok, pid} ->
            {:ok, MembraneRoom.describe(call_id), pid}

          {:error, {:already_started, pid}} ->
            {:ok, MembraneRoom.describe(call_id), pid}

          {:error, reason} ->
            {:error, reason}
        end
    end
  end

  def stop_room(call_id) when is_binary(call_id) do
    case Registry.lookup(VostokServer.Calls.RoomRegistry, call_id) do
      [{pid, _value}] -> DynamicSupervisor.terminate_child(__MODULE__, pid)
      [] -> :ok
    end
  end

  @impl true
  def init(:ok) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end
end
