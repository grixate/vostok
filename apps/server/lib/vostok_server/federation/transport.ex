defmodule VostokServer.Federation.Transport do
  @moduledoc """
  Behaviour for outbound federation transport adapters.
  """

  alias VostokServer.Federation.DeliveryJob
  alias VostokServer.Federation.Peer

  @type delivery_result ::
          {:ok, map()}
          | {:error, {:retryable, String.t()}}
          | {:error, {:permanent, String.t()}}

  @callback deliver(Peer.t(), DeliveryJob.t(), keyword()) :: delivery_result
end
