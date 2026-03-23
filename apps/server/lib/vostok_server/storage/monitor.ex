defmodule VostokServer.Storage.Monitor do
  @moduledoc """
  Monitors hot cache disk usage and triggers alerts or emergency eviction
  when thresholds are breached.
  """

  use GenServer

  alias VostokServer.Storage.{HotCache, EvictionWorker}

  require Logger

  @check_interval_ms 60_000  # Check every minute

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Get current storage status."
  def status do
    GenServer.call(__MODULE__, :status)
  end

  @doc "Check if uploads should be rejected due to capacity."
  def uploads_allowed?(byte_size \\ 0) do
    ratio = HotCache.usage_ratio()

    cond do
      ratio >= 0.98 -> false
      ratio >= 0.95 && byte_size > 10_000_000 -> false  # >95%: reject files >10MB
      true -> true
    end
  end

  # ── GenServer callbacks ───────────────────────────────────────────────

  @impl true
  def init(_opts) do
    schedule_check()
    {:ok, %{last_ratio: 0.0, alert_level: :normal}}
  end

  @impl true
  def handle_info(:check, state) do
    ratio =
      try do
        HotCache.usage_ratio()
      rescue
        _ -> state.last_ratio
      end

    new_alert = classify_alert(ratio)

    if new_alert != state.alert_level do
      log_alert_change(state.alert_level, new_alert, ratio)

      if new_alert in [:critical, :emergency] do
        EvictionWorker.run_now()
      end
    end

    schedule_check()
    {:noreply, %{state | last_ratio: ratio, alert_level: new_alert}}
  end

  @impl true
  def handle_call(:status, _from, state) do
    usage = HotCache.current_usage()
    max = HotCache.max_bytes()

    {:reply,
     %{
       usage_bytes: usage,
       max_bytes: max,
       usage_ratio: Float.round(usage / max(max, 1), 4),
       alert_level: state.alert_level,
       uploads_allowed: uploads_allowed?()
     }, state}
  end

  # ── Private ───────────────────────────────────────────────────────────

  defp classify_alert(ratio) do
    cond do
      ratio >= 0.98 -> :emergency
      ratio >= 0.95 -> :critical
      ratio >= 0.80 -> :high
      ratio >= 0.70 -> :warning
      true -> :normal
    end
  end

  defp log_alert_change(old, new, ratio) do
    pct = Float.round(ratio * 100, 1)

    case new do
      :emergency ->
        Logger.error("[StorageMonitor] EMERGENCY: #{pct}% capacity — rejecting uploads")

      :critical ->
        Logger.error("[StorageMonitor] CRITICAL: #{pct}% capacity — emergency eviction triggered")

      :high ->
        Logger.warning("[StorageMonitor] HIGH: #{pct}% capacity — accelerating eviction")

      :warning ->
        Logger.warning("[StorageMonitor] WARNING: #{pct}% capacity")

      :normal when old != :normal ->
        Logger.info("[StorageMonitor] Capacity returned to normal: #{pct}%")

      _ ->
        :ok
    end
  end

  defp schedule_check do
    Process.send_after(self(), :check, @check_interval_ms)
  end
end
