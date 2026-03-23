defmodule VostokServer.Auth.RateLimiter do
  @moduledoc """
  ETS-based progressive login lockout.

  Thresholds:
  - 5 failures  → 30 second cooldown
  - 10 failures → 5 minute cooldown
  - 20 failures → 30 minute cooldown
  """

  use GenServer

  @table :vostok_auth_rate_limits
  @prune_interval :timer.minutes(5)

  # ── Public API ──────────────────────────────────────────────────────────

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  @doc "Check whether a login attempt is allowed. Returns :ok or {:error, seconds_remaining}."
  def check_rate(username, ip) do
    now = System.system_time(:second)

    username_result = check_key("user:#{username}", now)
    ip_result = check_key("ip:#{ip}", now)

    case {username_result, ip_result} do
      {:ok, :ok} -> :ok
      {{:error, secs}, _} -> {:error, secs}
      {_, {:error, secs}} -> {:error, secs}
    end
  end

  @doc "Record a failed login attempt."
  def record_failure(username, ip) do
    now = System.system_time(:second)
    increment_key("user:#{username}", now)
    increment_key("ip:#{ip}", now)
    :ok
  end

  @doc "Reset failure count after successful login."
  def reset(username, ip) do
    :ets.delete(@table, "user:#{username}")
    :ets.delete(@table, "ip:#{ip}")
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

  defp check_key(key, now) do
    case :ets.lookup(@table, key) do
      [{^key, _count, locked_until}] when locked_until > now ->
        {:error, locked_until - now}

      [{^key, count, _locked_until}] ->
        lockout = lockout_seconds(count)

        if lockout > 0 do
          {:error, lockout}
        else
          :ok
        end

      [] ->
        :ok
    end
  end

  defp increment_key(key, now) do
    case :ets.lookup(@table, key) do
      [{^key, count, _}] ->
        new_count = count + 1
        lockout = lockout_seconds(new_count)
        locked_until = if lockout > 0, do: now + lockout, else: 0
        :ets.insert(@table, {key, new_count, locked_until})

      [] ->
        :ets.insert(@table, {key, 1, 0})
    end
  end

  defp lockout_seconds(count) when count >= 20, do: 1800
  defp lockout_seconds(count) when count >= 10, do: 300
  defp lockout_seconds(count) when count >= 5, do: 30
  defp lockout_seconds(_), do: 0

  defp prune_expired do
    now = System.system_time(:second)
    # Remove entries older than 1 hour with no recent activity
    :ets.foldl(
      fn {key, _count, locked_until}, acc ->
        if locked_until > 0 and locked_until + 3600 < now do
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
