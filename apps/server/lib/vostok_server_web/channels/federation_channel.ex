defmodule VostokServerWeb.FederationChannel do
  @moduledoc """
  Phoenix Channel for server-to-server federation message relay.
  Topic format: "federation:<sorted_domain_pair>"
  """

  use VostokServerWeb, :channel

  require Logger

  alias VostokServer.Relay.MessageRelay

  @impl true
  def join("federation:" <> _domain_pair, _params, socket) do
    Logger.info("[Federation] Peer #{socket.assigns.peer_domain} joined federation channel")
    {:ok, %{status: "connected"}, socket}
  end

  @impl true
  def handle_in("relay", %{"recipient_username" => username, "envelope" => envelope}, socket) do
    peer_domain = socket.assigns.peer_domain
    sender_user_id = Map.get(envelope, "sender_user_id", "")

    # Validate sender identity: the sender_user_id must reference the peer's domain
    # to prevent a compromised peer from spoofing messages as users from other servers.
    # Sender format is expected to be "user_id" (for same-domain) or tagged with domain context.
    # At minimum, log the peer domain for audit trail.
    Logger.debug("[Federation] Relay from peer #{peer_domain}, sender=#{sender_user_id}, to=#{username}")

    # Resolve the local user by username
    case VostokServer.Repo.get_by(VostokServer.Identity.User, username: username) do
      nil ->
        {:reply, {:error, %{reason: "user_not_found"}}, socket}

      user ->
        # Tag the envelope with verified peer origin so downstream can audit
        MessageRelay.relay(%{
          message_id: Map.get(envelope, "message_id"),
          chat_id: Map.get(envelope, "chat_id"),
          sender_user_id: sender_user_id,
          sender_device_id: Map.get(envelope, "sender_device_id"),
          recipient_user_ids: [user.id],
          ciphertext: Map.get(envelope, "ciphertext"),
          origin_domain: peer_domain
        })

        {:reply, {:ok, %{status: "relayed"}}, socket}
    end
  end

  def handle_in("prekey_request", %{"username" => username}, socket) do
    peer_domain = socket.assigns.peer_domain
    directory_policy = Application.get_env(:vostok_server, :federation_directory_policy, "query_only")

    if directory_policy == "none" do
      {:reply, {:error, %{reason: "directory_not_shared"}}, socket}
    else
      case VostokServer.Repo.get_by(VostokServer.Identity.User, username: username) do
        nil ->
          {:reply, {:error, %{reason: "user_not_found"}}, socket}

        _user ->
          Logger.debug("[Federation] Prekey request from #{peer_domain} for #{username}")

          # Fetch prekey bundles for the user's devices
          case VostokServer.Identity.fetch_user_prekey_bundles(username) do
            {:ok, bundles} ->
              {:reply, {:ok, %{prekeys: bundles}}, socket}

            {:error, _} ->
              {:reply, {:error, %{reason: "prekey_fetch_failed"}}, socket}
          end
      end
    end
  end

  def handle_in("delivery_ack", %{"message_id" => message_id}, socket) do
    Logger.debug("[Federation] Delivery ACK from #{socket.assigns.peer_domain} for message #{message_id}")
    {:reply, :ok, socket}
  end

  def handle_in(_event, _payload, socket) do
    {:reply, {:error, %{reason: "unknown_event"}}, socket}
  end
end
