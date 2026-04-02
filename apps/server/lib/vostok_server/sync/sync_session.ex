defmodule VostokServer.Sync.SyncSession do
  @moduledoc """
  ETS-backed sync session tracking for device-to-device history sync.
  Tracks active sync sessions and auto-cleans after inactivity.
  """

  use GenServer
  require Logger

  @table __MODULE__
  @cleanup_interval :timer.minutes(5)
  @session_timeout_ms :timer.minutes(30)

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @doc "Create a sync session between requester and provider devices."
  def create(user_id, requester_device_id, provider_device_id) do
    session = %{
      user_id: user_id,
      requester_device_id: requester_device_id,
      provider_device_id: provider_device_id,
      status: :active,
      last_activity_at: System.monotonic_time(:millisecond),
      created_at: DateTime.utc_now()
    }

    key = {user_id, requester_device_id}
    :ets.insert(@table, {key, session})
    :ok
  end

  @doc "Touch a sync session to prevent timeout."
  def touch(user_id, requester_device_id) do
    key = {user_id, requester_device_id}

    case :ets.lookup(@table, key) do
      [{^key, session}] ->
        updated = %{session | last_activity_at: System.monotonic_time(:millisecond)}
        :ets.insert(@table, {key, updated})
        :ok

      [] ->
        {:error, :not_found}
    end
  end

  @doc "Get a sync session."
  def get(user_id, requester_device_id) do
    key = {user_id, requester_device_id}

    case :ets.lookup(@table, key) do
      [{^key, session}] -> {:ok, session}
      [] -> {:error, :not_found}
    end
  end

  @doc "Remove a sync session (on completion or cancel)."
  def remove(user_id, requester_device_id) do
    :ets.delete(@table, {user_id, requester_device_id})
    :ok
  end

  @doc "List pending sync requests for a user (no provider yet)."
  def pending_requests(user_id) do
    match_spec = [
      {{{user_id, :"$1"}, :"$2"}, [], [{{:"$1", :"$2"}}]}
    ]

    :ets.select(@table, match_spec)
    |> Enum.map(fn {device_id, session} -> {device_id, session} end)
  end

  # ── GenServer callbacks ──────────────────────────────────────────────

  @impl true
  def init(:ok) do
    :ets.new(@table, [:named_table, :public, :set])
    schedule_cleanup()
    {:ok, %{}}
  end

  @impl true
  def handle_info(:cleanup, state) do
    now = System.monotonic_time(:millisecond)

    expired =
      :ets.tab2list(@table)
      |> Enum.filter(fn {_key, session} ->
        now - session.last_activity_at > @session_timeout_ms
      end)

    for {key, session} <- expired do
      Logger.info("[SyncSession] Expired sync session for user #{session.user_id}, requester #{session.requester_device_id}")
      :ets.delete(@table, key)
    end

    schedule_cleanup()
    {:noreply, state}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  defp schedule_cleanup do
    Process.send_after(self(), :cleanup, @cleanup_interval)
  end
end
