defmodule VostokServer.Messaging.RateLimiter do
  @moduledoc """
  ETS-based message send rate limiter.

  Tracks message sends per user with a sliding window counter.
  Returns :ok or {:error, seconds_remaining} on check.

  Limits:
  - 60 messages per minute per user
  - 500 messages per hour per user
  """

  use GenServer

  @table :vostok_message_rate_limits
  @prune_interval :timer.minutes(5)

  @per_minute_limit 60
  @per_hour_limit 500
  @minute_window 60
  @hour_window 3600

  # ── Public API ──────────────────────────────────────────────────────────

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  @doc """
  Check whether a user is allowed to send a message.
  Returns :ok or {:error, seconds_remaining}.
  """
  def check_rate(user_id) do
    now = System.system_time(:second)
    minute_key = "msg:#{user_id}:min"
    hour_key = "msg:#{user_id}:hr"

    minute_result = check_window(minute_key, now, @minute_window, @per_minute_limit)
    hour_result = check_window(hour_key, now, @hour_window, @per_hour_limit)

    case {minute_result, hour_result} do
      {:ok, :ok} -> :ok
      {{:error, secs}, _} -> {:error, secs}
      {_, {:error, secs}} -> {:error, secs}
    end
  end

  @doc "Record a successful message send."
  def record_send(user_id) do
    now = System.system_time(:second)
    minute_key = "msg:#{user_id}:min"
    hour_key = "msg:#{user_id}:hr"
    increment_window(minute_key, now, @minute_window)
    increment_window(hour_key, now, @hour_window)
    :ok
  end

  # ── GenServer callbacks ─────────────────────────────────────────────────

  @impl true
  def init(_) do
    :ets.new(@table, [:named_table, :public, :set])
    schedule_prune()
    {:ok, %{}}
  end

  @impl true
  def handle_info(:prune, state) do
    prune_expired()
    schedule_prune()
    {:noreply, state}
  end

  # ── Internals ───────────────────────────────────────────────────────────

  defp check_window(key, now, window_seconds, limit) do
    case :ets.lookup(@table, key) do
      [{^key, count, window_start}] ->
        if now - window_start > window_seconds do
          # Window expired — reset
          :ok
        else
          if count >= limit do
            remaining = window_seconds - (now - window_start)
            {:error, max(remaining, 1)}
          else
            :ok
          end
        end

      [] ->
        :ok
    end
  end

  defp increment_window(key, now, window_seconds) do
    case :ets.lookup(@table, key) do
      [{^key, count, window_start}] ->
        if now - window_start > window_seconds do
          # Window expired — start new window
          :ets.insert(@table, {key, 1, now})
        else
          :ets.insert(@table, {key, count + 1, window_start})
        end

      [] ->
        :ets.insert(@table, {key, 1, now})
    end
  end

  defp prune_expired do
    now = System.system_time(:second)

    :ets.foldl(
      fn {key, _count, window_start}, acc ->
        # Remove entries older than 2 hours
        if now - window_start > 7200 do
          :ets.delete(@table, key)
        end

        acc
      end,
      :ok,
      @table
    )
  end

  defp schedule_prune do
    Process.send_after(self(), :prune, @prune_interval)
  end
end
