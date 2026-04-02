defmodule VostokServer.Relay.DeviceRegistry do
  @moduledoc """
  ETS-backed registry mapping {user_id, device_id} → channel PID for online devices.
  All mutations go through the GenServer to ensure atomicity between
  Process.monitor and ETS insertion.
  """

  use GenServer

  @table __MODULE__

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @doc "Register a device channel as online (serialized through GenServer)."
  def register(user_id, device_id, channel_pid) do
    GenServer.call(__MODULE__, {:register, user_id, device_id, channel_pid})
  end

  @doc "Unregister a device channel (serialized through GenServer)."
  def unregister(user_id, device_id) do
    GenServer.call(__MODULE__, {:unregister, user_id, device_id})
  end

  @doc "Return all online {device_id, pid} tuples for a user (direct ETS read, safe)."
  def online_devices(user_id) do
    :ets.match(@table, {{user_id, :"$1"}, :"$2", :_})
    |> Enum.map(fn [device_id, pid] -> {device_id, pid} end)
  end

  @doc "Check if a specific device is online."
  def online?(user_id, device_id) do
    :ets.lookup(@table, {user_id, device_id}) != []
  end

  # ── GenServer callbacks ──────────────────────────────────────────────

  @impl true
  def init(:ok) do
    :ets.new(@table, [:named_table, :public, :set])
    {:ok, %{refs: %{}}}
  end

  @impl true
  def handle_call({:register, user_id, device_id, channel_pid}, _from, state) do
    key = {user_id, device_id}

    # Clean up previous registration for the same key if it exists
    state = cleanup_key(key, state)

    # Monitor the new channel process and insert atomically
    ref = Process.monitor(channel_pid)
    :ets.insert(@table, {key, channel_pid, ref})

    # Track ref → key mapping for DOWN handler
    refs = Map.put(state.refs, ref, key)

    {:reply, :ok, %{state | refs: refs}}
  end

  def handle_call({:unregister, user_id, device_id}, _from, state) do
    key = {user_id, device_id}
    state = cleanup_key(key, state)
    {:reply, :ok, state}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, _reason}, state) do
    case Map.get(state.refs, ref) do
      nil ->
        {:noreply, state}

      key ->
        # Only delete if the ref still matches (prevents stale DOWN from removing a new registration)
        case :ets.lookup(@table, key) do
          [{^key, _pid, ^ref}] -> :ets.delete(@table, key)
          _ -> :ok
        end

        {:noreply, %{state | refs: Map.delete(state.refs, ref)}}
    end
  end

  def handle_info(_msg, state), do: {:noreply, state}

  # ── Private ──────────────────────────────────────────────────────────

  defp cleanup_key(key, state) do
    case :ets.lookup(@table, key) do
      [{^key, _pid, old_ref}] ->
        Process.demonitor(old_ref, [:flush])
        :ets.delete(@table, key)
        %{state | refs: Map.delete(state.refs, old_ref)}

      [] ->
        state
    end
  end
end
