defmodule VostokServer.Federation.DeliveryWorker do
  @moduledoc """
  Background delivery worker for outbound federation queue jobs.
  """

  use Oban.Worker, queue: :default, max_attempts: 20

  alias VostokServer.Federation

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"delivery_job_id" => delivery_job_id}})
      when is_binary(delivery_job_id) do
    case Federation.dispatch_delivery(delivery_job_id) do
      {:ok, %{status: "delivered"}} ->
        :ok

      {:ok, %{status: "failed"}} ->
        {:snooze, 30}

      {:error, {:not_found, _message}} ->
        :ok

      {:error, {_kind, message}} ->
        {:error, message}
    end
  end

  def perform(_job), do: :ok
end
