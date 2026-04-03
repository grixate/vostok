defmodule VostokServer.Workers.StaleCallCleanupWorker do
  @moduledoc """
  Periodically cleans up stale call resources:

  1. Marks participants as "left" if their call ended but they were never
     explicitly removed (e.g. client crashed without sending `leave`).
  2. Ends calls that have been in "ringing" or "active" status for too long
     without any participants.
  3. Deletes signals for calls that ended more than 7 days ago.

  Runs hourly via Oban cron.
  """

  use Oban.Worker, queue: :maintenance, max_attempts: 3

  import Ecto.Query
  require Logger

  alias VostokServer.Calls.{CallSession, CallParticipant, CallSignal}
  alias VostokServer.Repo

  @batch_size 1000
  # Participants joined for longer than 2 hours in an ended call are stale
  @stale_participant_hours 2
  # Signals for calls ended more than 7 days ago are deleted
  @signal_retention_days 7
  # Calls stuck in "ringing" for more than 2 minutes are abandoned
  @stale_ringing_minutes 2
  # Calls stuck in "active" with no joined participants for 30 minutes
  @stale_active_minutes 30

  @impl Oban.Worker
  def perform(_job) do
    now = DateTime.utc_now()

    stale_participants = cleanup_stale_participants(now)
    stale_calls = cleanup_stale_calls(now)
    stale_signals = cleanup_stale_signals(now)

    if stale_participants > 0 or stale_calls > 0 or stale_signals > 0 do
      Logger.info(
        "[StaleCallCleanup] Cleaned #{stale_participants} participants, " <>
          "#{stale_calls} calls, #{stale_signals} signals"
      )
    end

    :ok
  end

  # Mark participants as "left" for calls that already ended
  defp cleanup_stale_participants(now) do
    cutoff = DateTime.add(now, -@stale_participant_hours, :hour)

    ended_call_ids =
      from(c in CallSession,
        where: c.status == "ended",
        select: c.id
      )

    {count, _} =
      from(p in CallParticipant,
        where:
          p.status == "joined" and
            p.call_id in subquery(ended_call_ids) and
            p.joined_at < ^cutoff
      )
      |> Repo.update_all(set: [status: "left", left_at: now])

    count
  end

  # End calls stuck in ringing/active with no real activity
  defp cleanup_stale_calls(now) do
    ringing_cutoff = DateTime.add(now, -@stale_ringing_minutes, :minute)
    active_cutoff = DateTime.add(now, -@stale_active_minutes, :minute)

    # Stale ringing calls (ring timeout should catch most, this is a safety net)
    stale_ringing =
      from(c in CallSession,
        where: c.status == "ringing" and c.started_at < ^ringing_cutoff,
        select: c.id,
        limit: @batch_size
      )
      |> Repo.all()

    # Active calls with zero joined participants
    active_with_no_participants =
      from(c in CallSession,
        where: c.status == "active" and c.started_at < ^active_cutoff,
        left_join: p in CallParticipant,
        on: p.call_id == c.id and p.status == "joined",
        group_by: c.id,
        having: count(p.id) == 0,
        select: c.id,
        limit: @batch_size
      )
      |> Repo.all()

    call_ids = Enum.uniq(stale_ringing ++ active_with_no_participants)

    if call_ids != [] do
      from(p in CallParticipant,
        where: p.call_id in ^call_ids and p.status == "joined"
      )
      |> Repo.update_all(set: [status: "left", left_at: now])

      # Stale ringing calls are "missed"; active calls with no participants are "normal" (abandoned)
      ringing_set = MapSet.new(stale_ringing)

      if stale_ringing != [] do
        from(c in CallSession, where: c.id in ^stale_ringing)
        |> Repo.update_all(set: [status: "ended", end_reason: "missed", ended_at: now])
      end

      abandoned = Enum.reject(active_with_no_participants, &MapSet.member?(ringing_set, &1))

      if abandoned != [] do
        from(c in CallSession, where: c.id in ^abandoned)
        |> Repo.update_all(set: [status: "ended", end_reason: "normal", ended_at: now])
      end

      length(call_ids)
    else
      0
    end
  end

  # Delete signals for calls that ended more than N days ago
  defp cleanup_stale_signals(now) do
    cutoff = DateTime.add(now, -@signal_retention_days, :day)

    ended_call_ids =
      from(c in CallSession,
        where: c.status == "ended" and c.ended_at < ^cutoff,
        select: c.id,
        limit: @batch_size
      )
      |> Repo.all()

    if ended_call_ids == [] do
      0
    else
      {count, _} =
        from(s in CallSignal, where: s.call_id in ^ended_call_ids)
        |> Repo.delete_all()

      # If we hit the batch limit, schedule another run
      if length(ended_call_ids) >= @batch_size do
        %{} |> __MODULE__.new(schedule_in: 5) |> Oban.insert()
      end

      count
    end
  end
end
