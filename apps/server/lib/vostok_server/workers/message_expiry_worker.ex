defmodule VostokServer.Workers.MessageExpiryWorker do
  @moduledoc """
  Periodically purges messages that have exceeded their TTL.
  Runs every 15 minutes via Oban cron.
  """

  use Oban.Worker, queue: :maintenance, max_attempts: 3

  import Ecto.Query
  require Logger

  alias VostokServer.Messaging.{Message, MessageReaction, MessageRecipient}
  alias VostokServer.Repo

  @batch_size 1000

  @impl Oban.Worker
  def perform(_job) do
    now = DateTime.utc_now()

    # Find expired message IDs in batches to avoid huge IN clauses
    expired_ids =
      from(m in Message,
        where: not is_nil(m.expires_at) and m.expires_at < ^now,
        select: m.id,
        limit: @batch_size
      )
      |> Repo.all()

    if expired_ids == [] do
      :ok
    else
      # Delete dependent records first (foreign keys)
      {reaction_count, _} =
        from(r in MessageReaction, where: r.message_id in ^expired_ids)
        |> Repo.delete_all()

      {recipient_count, _} =
        from(r in MessageRecipient, where: r.message_id in ^expired_ids)
        |> Repo.delete_all()

      # Delete the messages
      {message_count, _} =
        from(m in Message, where: m.id in ^expired_ids)
        |> Repo.delete_all()

      Logger.info("[MessageExpiry] Purged #{message_count} messages, #{recipient_count} envelopes, #{reaction_count} reactions")

      # If we hit the batch limit, there may be more — schedule another run immediately
      if length(expired_ids) >= @batch_size do
        %{} |> __MODULE__.new(schedule_in: 1) |> Oban.insert()
      end

      :ok
    end
  end
end
