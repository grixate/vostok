defmodule VostokServer.Federation do
  @moduledoc """
  Stage 6 federation admin scaffold.
  """

  alias VostokServer.Federation.{DeliveryJob, DeliveryWorker, Peer}
  alias VostokServer.Repo

  def list_peers do
    Peer
    |> Repo.all()
    |> Enum.sort_by(& &1.inserted_at, {:desc, DateTime})
    |> Enum.map(&present_peer/1)
  end

  def list_delivery_jobs do
    DeliveryJob
    |> Repo.all()
    |> Enum.sort_by(& &1.inserted_at, {:desc, DateTime})
    |> Enum.map(&present_delivery_job/1)
  end

  def queue_delivery(peer_id, attrs \\ %{}) when is_binary(peer_id) and is_map(attrs) do
    with %Peer{} <- Repo.get(Peer, peer_id),
         {:ok, normalized} <- normalize_delivery_attrs(peer_id, attrs) do
      Repo.transaction(fn ->
        with {:ok, delivery_job} <-
               %DeliveryJob{}
               |> DeliveryJob.changeset(normalized)
               |> Repo.insert(),
             {:ok, _oban_job} <- enqueue_delivery_job(delivery_job.id) do
          present_delivery_job(delivery_job)
        else
          {:error, %Ecto.Changeset{} = changeset} ->
            Repo.rollback({:validation, format_changeset_error(changeset)})

          {:error, reason} ->
            Repo.rollback({:unknown, format_background_error(reason)})
        end
      end)
      |> case do
        {:ok, delivery_job} -> {:ok, delivery_job}
        {:error, error} -> {:error, error}
      end
    else
      nil ->
        {:error, {:not_found, "Federation peer not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def attempt_delivery(job_id, attrs \\ %{}) when is_binary(job_id) and is_map(attrs) do
    with %DeliveryJob{} = job <- Repo.get(DeliveryJob, job_id),
         {:ok, normalized} <- normalize_delivery_attempt_attrs(job, attrs) do
      job
      |> DeliveryJob.changeset(normalized)
      |> Repo.update()
      |> case do
        {:ok, updated_job} -> {:ok, present_delivery_job(updated_job)}
        {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
      end
    else
      nil ->
        {:error, {:not_found, "Federation delivery job not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def dispatch_delivery(job_id) when is_binary(job_id) do
    with %DeliveryJob{} = job <- Repo.get(DeliveryJob, job_id),
         %Peer{} = peer <- Repo.get(Peer, job.peer_id) do
      cond do
        job.status == "delivered" ->
          {:ok, present_delivery_job(job)}

        peer.status == "active" ->
          attempt_delivery(job_id, %{"outcome" => "delivered"})

        peer.status == "disabled" ->
          attempt_delivery(job_id, %{"outcome" => "failed", "last_error" => "Peer is disabled."})

        true ->
          attempt_delivery(job_id, %{
            "outcome" => "failed",
            "last_error" => "Peer is not active yet."
          })
      end
    else
      nil ->
        {:error, {:not_found, "Federation delivery job or peer not found."}}
    end
  end

  def create_peer(attrs) when is_map(attrs) do
    with {:ok, normalized} <- normalize_peer_attrs(attrs) do
      %Peer{}
      |> Peer.changeset(normalized)
      |> Repo.insert()
      |> case do
        {:ok, peer} -> {:ok, present_peer(peer)}
        {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
      end
    end
  end

  def update_peer_status(peer_id, status) when is_binary(peer_id) do
    with %Peer{} = peer <- Repo.get(Peer, peer_id),
         {:ok, normalized_status} <- normalize_status(status) do
      peer
      |> Peer.changeset(%{
        status: normalized_status,
        last_error: nil
      })
      |> Repo.update()
      |> case do
        {:ok, updated_peer} -> {:ok, present_peer(updated_peer)}
        {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
      end
    else
      nil ->
        {:error, {:not_found, "Federation peer not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def record_peer_heartbeat(peer_id) when is_binary(peer_id) do
    with %Peer{} = peer <- Repo.get(Peer, peer_id) do
      peer
      |> Peer.changeset(%{
        status: "active",
        last_error: nil,
        last_seen_at: DateTime.utc_now()
      })
      |> Repo.update()
      |> case do
        {:ok, updated_peer} -> {:ok, present_peer(updated_peer)}
        {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
      end
    else
      nil ->
        {:error, {:not_found, "Federation peer not found."}}
    end
  end

  defp normalize_peer_attrs(attrs) do
    domain = attrs |> Map.get("domain") |> normalize_string()
    display_name = attrs |> Map.get("display_name") |> normalize_string()

    if is_nil(domain) do
      {:error, {:validation, "domain is required."}}
    else
      {:ok,
       %{
         domain: domain,
         display_name: display_name,
         status: "pending"
       }}
    end
  end

  defp normalize_status(status) when is_binary(status) do
    case normalize_string(status) do
      "pending" = normalized_status -> {:ok, normalized_status}
      "active" = normalized_status -> {:ok, normalized_status}
      "disabled" = normalized_status -> {:ok, normalized_status}
      _ -> {:error, {:validation, "status must be pending, active, or disabled."}}
    end
  end

  defp normalize_status(_),
    do: {:error, {:validation, "status must be pending, active, or disabled."}}

  defp present_peer(%Peer{} = peer) do
    %{
      id: peer.id,
      domain: peer.domain,
      display_name: peer.display_name,
      status: peer.status,
      last_error: peer.last_error,
      last_seen_at: iso_or_nil(peer.last_seen_at),
      inserted_at: iso_or_nil(peer.inserted_at),
      updated_at: iso_or_nil(peer.updated_at)
    }
  end

  defp normalize_delivery_attrs(peer_id, attrs) do
    event_type =
      attrs
      |> Map.get("event_type", "message_relay")
      |> normalize_string()

    payload =
      case Map.get(attrs, "payload", %{}) do
        payload when is_map(payload) -> payload
        _ -> nil
      end

    if is_nil(event_type) do
      {:error, {:validation, "event_type is required."}}
    else
      {:ok,
       %{
         peer_id: peer_id,
         direction: "outbound",
         event_type: event_type,
         status: "queued",
         payload: payload || %{},
         attempt_count: 0,
         available_at: DateTime.utc_now(),
         last_error: nil
       }}
    end
  end

  defp normalize_delivery_attempt_attrs(%DeliveryJob{} = job, attrs) do
    outcome =
      attrs
      |> Map.get("outcome", "failed")
      |> normalize_string()

    last_error = attrs |> Map.get("last_error") |> normalize_string()
    now = DateTime.utc_now()

    case outcome do
      "processing" ->
        {:ok,
         %{
           status: "processing",
           attempt_count: job.attempt_count + 1,
           last_attempted_at: now
         }}

      "delivered" ->
        {:ok,
         %{
           status: "delivered",
           attempt_count: job.attempt_count + 1,
           last_attempted_at: now,
           delivered_at: now,
           last_error: nil
         }}

      "failed" ->
        {:ok,
         %{
           status: "failed",
           attempt_count: job.attempt_count + 1,
           last_attempted_at: now,
           available_at: DateTime.add(now, 30, :second),
           last_error: last_error || "Delivery attempt failed."
         }}

      _ ->
        {:error, {:validation, "outcome must be processing, delivered, or failed."}}
    end
  end

  defp present_delivery_job(%DeliveryJob{} = delivery_job) do
    %{
      id: delivery_job.id,
      peer_id: delivery_job.peer_id,
      direction: delivery_job.direction,
      event_type: delivery_job.event_type,
      status: delivery_job.status,
      payload: delivery_job.payload,
      attempt_count: delivery_job.attempt_count,
      available_at: iso_or_nil(delivery_job.available_at),
      last_attempted_at: iso_or_nil(delivery_job.last_attempted_at),
      delivered_at: iso_or_nil(delivery_job.delivered_at),
      last_error: delivery_job.last_error,
      inserted_at: iso_or_nil(delivery_job.inserted_at),
      updated_at: iso_or_nil(delivery_job.updated_at)
    }
  end

  defp enqueue_delivery_job(delivery_job_id) when is_binary(delivery_job_id) do
    %{"delivery_job_id" => delivery_job_id}
    |> DeliveryWorker.new()
    |> Oban.insert()
  end

  defp normalize_string(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_string(_), do: nil

  defp format_changeset_error(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
    |> Enum.map(fn {field, [message | _]} -> "#{field} #{message}" end)
    |> List.first()
    |> Kernel.||("The federation peer could not be saved.")
  end

  defp format_background_error(%Ecto.Changeset{} = changeset),
    do: format_changeset_error(changeset)

  defp format_background_error(error) when is_binary(error), do: error
  defp format_background_error(error), do: inspect(error)

  defp iso_or_nil(nil), do: nil
  defp iso_or_nil(%DateTime{} = value), do: DateTime.to_iso8601(value)
end
