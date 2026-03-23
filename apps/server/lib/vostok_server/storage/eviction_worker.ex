defmodule VostokServer.Storage.EvictionWorker do
  @moduledoc """
  Periodic worker that enforces media retention policies.
  Runs on a configurable interval and evicts media from the hot cache
  in priority order.
  """

  use GenServer

  import Ecto.Query

  alias VostokServer.Media.Upload
  alias VostokServer.Repo
  alias VostokServer.Storage.HotCache

  require Logger

  @default_interval_ms 900_000  # 15 minutes
  @default_batch_size 100
  @default_max_age_days 30
  @default_grace_period_hours 48

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Trigger a manual eviction run."
  def run_now do
    GenServer.cast(__MODULE__, :run_eviction)
  end

  # ── GenServer callbacks ───────────────────────────────────────────────

  @impl true
  def init(_opts) do
    schedule_next_run()
    Logger.info("[EvictionWorker] Started with #{interval_ms()}ms interval")
    {:ok, %{last_run_at: nil, items_evicted: 0}}
  end

  @impl true
  def handle_info(:tick, state) do
    new_state = do_eviction(state)
    schedule_next_run()
    {:noreply, new_state}
  end

  @impl true
  def handle_cast(:run_eviction, state) do
    new_state = do_eviction(state)
    {:noreply, new_state}
  end

  # ── Eviction logic ───────────────────────────────────────────────────

  defp do_eviction(state) do
    batch_size = config()[:eviction_batch_size] || @default_batch_size
    usage_ratio = HotCache.usage_ratio()

    candidates =
      cond do
        # Emergency: >95% full — evict oldest regardless
        usage_ratio > 0.95 ->
          query_oldest_available(batch_size)

        # High pressure: >80% — evict fully delivered items early
        usage_ratio > 0.80 ->
          query_fully_delivered(batch_size)

        # Normal: evict per policy
        true ->
          query_policy_candidates(batch_size)
      end

    evicted_count = Enum.count(candidates, &evict_item/1)

    if evicted_count > 0 do
      Logger.info("[EvictionWorker] Evicted #{evicted_count} items (usage: #{Float.round(usage_ratio * 100, 1)}%)")
    end

    %{state | last_run_at: DateTime.utc_now(), items_evicted: state.items_evicted + evicted_count}
  end

  defp evict_item(%Upload{} = upload) do
    alias VostokServer.Storage.ObjectStore

    # Re-read from DB to get fresh state — prevents race with concurrent
    # downloads or uploads that updated the record since the batch query.
    case Repo.get(Upload, upload.id) do
      %Upload{media_status: "available", storage_tier: "hot"} = fresh ->
        # Skip if accessed in the last 30 seconds (likely being downloaded)
        recently_accessed =
          fresh.last_accessed_at &&
            DateTime.diff(DateTime.utc_now(), fresh.last_accessed_at, :second) < 30

        if recently_accessed do
          false
        else
          if ObjectStore.enabled?() do
            offload_to_object_store(fresh)
          else
            delete_from_hot_cache(fresh)
          end
        end

      _ ->
        # Already evicted or state changed — skip
        false
    end
  end

  defp offload_to_object_store(%Upload{} = upload) do
    alias VostokServer.Storage.ObjectStore

    with {:ok, blob} <- HotCache.get(upload.id),
         object_key = ObjectStore.object_key(upload_chat_id(upload), upload.id),
         adapter = ObjectStore.adapter(),
         {:ok, _} <- adapter.put(object_key, blob, upload.content_type || "application/octet-stream"),
         :ok <- HotCache.delete(upload.id) do
      upload
      |> Upload.changeset(%{
        storage_tier: "object",
        object_key: object_key,
        media_status: "available",
        evicted_at: DateTime.utc_now(),
        hot_cache_path: nil
      })
      |> Repo.update()

      Logger.debug("[EvictionWorker] Offloaded #{upload.id} to object storage")
      true
    else
      {:error, reason} ->
        Logger.warning("[EvictionWorker] Failed to offload #{upload.id}: #{inspect(reason)}")

        # If media is past 2x max age, delete from hot cache even if offload fails
        # to prevent unbounded growth when object storage is unreachable.
        max_age = max_age_days() * 86400
        age = DateTime.diff(DateTime.utc_now(), upload.inserted_at, :second)

        if age > max_age * 2 do
          Logger.warning("[EvictionWorker] Deleting #{upload.id} after failed offload (age: #{div(age, 86400)}d)")
          delete_from_hot_cache(upload)
        else
          false
        end
    end
  end

  defp delete_from_hot_cache(%Upload{} = upload) do
    case HotCache.delete(upload.id) do
      :ok ->
        upload
        |> Upload.changeset(%{
          storage_tier: "deleted",
          media_status: "evicted",
          evicted_at: DateTime.utc_now(),
          hot_cache_path: nil
        })
        |> Repo.update()
        true

      {:error, reason} ->
        Logger.warning("[EvictionWorker] Failed to delete #{upload.id}: #{inspect(reason)}")
        false
    end
  end

  # Best-effort chat_id lookup for object key partitioning.
  # The upload doesn't directly reference a chat, so we check
  # if there's a message referencing this upload.
  defp upload_chat_id(%Upload{} = _upload) do
    "unknown"
  end

  # ── Queries ──────────────────────────────────────────────────────────

  # Fully delivered items past grace period
  defp query_policy_candidates(batch_size) do
    grace_cutoff = DateTime.add(DateTime.utc_now(), -grace_period_hours() * 3600, :second)
    max_age_cutoff = DateTime.add(DateTime.utc_now(), -max_age_days() * 86400, :second)

    # Priority 1: fully delivered + past grace
    delivered =
      from(u in Upload,
        where: u.media_status == "available" and u.storage_tier == "hot",
        where: u.fully_delivered == true and u.fully_delivered_at < ^grace_cutoff,
        order_by: [asc: u.inserted_at],
        limit: ^batch_size
      )
      |> Repo.all()

    remaining = batch_size - length(delivered)

    # Priority 2: past max age
    aged =
      if remaining > 0 do
        from(u in Upload,
          where: u.media_status == "available" and u.storage_tier == "hot",
          where: u.inserted_at < ^max_age_cutoff,
          order_by: [asc: u.inserted_at],
          limit: ^remaining
        )
        |> Repo.all()
      else
        []
      end

    (delivered ++ aged) |> Enum.uniq_by(& &1.id)
  end

  defp query_fully_delivered(batch_size) do
    from(u in Upload,
      where: u.media_status == "available" and u.storage_tier == "hot",
      where: u.fully_delivered == true,
      order_by: [asc: u.inserted_at],
      limit: ^batch_size
    )
    |> Repo.all()
  end

  defp query_oldest_available(batch_size) do
    from(u in Upload,
      where: u.media_status == "available" and u.storage_tier == "hot",
      order_by: [asc: u.last_accessed_at, asc: u.inserted_at],
      limit: ^batch_size
    )
    |> Repo.all()
  end

  # ── Config helpers ───────────────────────────────────────────────────

  defp schedule_next_run do
    Process.send_after(self(), :tick, interval_ms())
  end

  defp interval_ms, do: config()[:eviction_interval_ms] || @default_interval_ms
  defp max_age_days, do: config()[:max_age_days] || @default_max_age_days
  defp grace_period_hours, do: config()[:delivery_grace_period_hours] || @default_grace_period_hours

  defp config do
    Application.get_env(:vostok_server, VostokServer.Storage, [])
  end
end
