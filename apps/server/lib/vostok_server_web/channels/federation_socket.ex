defmodule VostokServerWeb.FederationSocket do
  @moduledoc """
  Phoenix Socket for server-to-server federation WebSocket connections.
  Authenticates peers via Ed25519 signed challenge.
  """

  use Phoenix.Socket

  alias VostokServer.Repo

  import Ecto.Query

  channel "federation:*", VostokServerWeb.FederationChannel

  @impl true
  def connect(%{"domain" => domain, "timestamp" => timestamp_str, "signature" => signature}, socket, _connect_info) do
    with {:ok, timestamp} <- parse_timestamp(timestamp_str),
         :ok <- validate_timestamp_window(timestamp),
         {:ok, peer} <- lookup_active_peer(domain),
         :ok <- verify_signature(peer, domain, timestamp_str, signature) do
      socket =
        socket
        |> assign(:peer_domain, domain)
        |> assign(:peer_id, peer.id)

      {:ok, socket}
    else
      _ -> :error
    end
  end

  def connect(_, _, _), do: :error

  @impl true
  def id(socket), do: "federation_socket:#{socket.assigns.peer_domain}"

  # ── Helpers ──────────────────────────────────────────────────────────

  defp parse_timestamp(timestamp_str) do
    case DateTime.from_iso8601(timestamp_str) do
      {:ok, dt, _offset} -> {:ok, dt}
      _ -> :error
    end
  end

  defp validate_timestamp_window(timestamp) do
    diff = abs(DateTime.diff(DateTime.utc_now(), timestamp, :second))

    if diff <= 300 do
      :ok
    else
      {:error, :timestamp_expired}
    end
  end

  defp lookup_active_peer(domain) do
    peer =
      from(p in VostokServer.Federation.Peer,
        where: p.domain == ^domain and p.status == :active
      )
      |> Repo.one()

    case peer do
      nil -> {:error, :unknown_peer}
      peer -> {:ok, peer}
    end
  end

  defp verify_signature(peer, domain, timestamp_str, signature) do
    message = "federation:#{domain}:#{timestamp_str}"

    case peer.public_key do
      nil ->
        {:error, :no_public_key}

      public_key when is_binary(public_key) ->
        case Base.decode64(signature) do
          {:ok, sig_bytes} ->
            if :crypto.verify(:eddsa, :none, message, sig_bytes, [public_key, :ed25519]) do
              :ok
            else
              {:error, :invalid_signature}
            end

          :error ->
            {:error, :invalid_signature}
        end
    end
  end
end
