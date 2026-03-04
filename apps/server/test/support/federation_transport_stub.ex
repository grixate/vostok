defmodule VostokServer.FederationTransportStub do
  @moduledoc false

  @behaviour VostokServer.Federation.Transport

  @impl VostokServer.Federation.Transport
  def deliver(peer, job, options) do
    if pid = Keyword.get(options, :notify_pid) do
      send(pid, {:federation_transport_attempt, peer.id, job.id, job.event_type})
    end

    case Keyword.get(options, :stub_outcome, :ok) do
      :ok ->
        {:ok, %{remote_status: 202}}

      :retryable_error ->
        {:error, {:retryable, "remote peer is unavailable"}}

      :permanent_error ->
        {:error, {:permanent, "remote peer rejected payload"}}

      {:retryable_error, message} when is_binary(message) ->
        {:error, {:retryable, message}}

      {:permanent_error, message} when is_binary(message) ->
        {:error, {:permanent, message}}

      _ ->
        {:error, {:retryable, "unknown transport stub outcome"}}
    end
  end
end
