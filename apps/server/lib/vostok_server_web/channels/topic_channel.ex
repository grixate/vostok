defmodule VostokServerWeb.TopicChannel do
  use VostokServerWeb, :channel

  alias VostokServer.Messaging
  alias VostokServer.Relay.DeviceRegistry
  alias VostokServer.Sync.SyncSession

  @impl true
  def join("chat:" <> chat_id = topic, _params, socket) do
    case Messaging.ensure_membership(chat_id, socket.assigns.user_id) do
      {:ok, _membership} ->
        {:ok, %{status: "connected", topic: topic}, assign(socket, :topic_name, topic)}

      {:error, _reason} ->
        {:error, %{reason: "unauthorized"}}
    end
  end

  def join("call:" <> chat_id = topic, _params, socket) do
    case Messaging.ensure_membership(chat_id, socket.assigns.user_id) do
      {:ok, _membership} ->
        {:ok, %{status: "connected", topic: topic}, assign(socket, :topic_name, topic)}

      {:error, _reason} ->
        {:error, %{reason: "unauthorized"}}
    end
  end

  def join("call-room:" <> room_id = topic, _params, socket) do
    case VostokServer.Calls.ensure_call_room_membership(room_id, socket.assigns.user_id) do
      {:ok, _membership} ->
        {:ok, %{status: "connected", topic: topic}, assign(socket, :topic_name, topic)}

      {:error, _reason} ->
        {:error, %{reason: "unauthorized"}}
    end
  end

  def join("user:" <> user_id = topic, _params, socket) do
    if socket.assigns.user_id == user_id do
      # Register this device in the DeviceRegistry
      DeviceRegistry.register(user_id, socket.assigns.device_id, self())

      {:ok, %{status: "connected", topic: topic}, assign(socket, :topic_name, topic)}
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  def join(_topic, _params, _socket), do: {:error, %{reason: "unsupported_topic"}}

  @impl true
  def handle_in("ping", payload, socket) do
    {:reply, {:ok, Map.put(payload, "topic", socket.assigns.topic_name)}, socket}
  end

  def handle_in("typing:start", _payload, socket) do
    broadcast_from!(socket, "typing:start", %{
      user_id: socket.assigns.user_id,
      username: socket.assigns.username
    })
    {:noreply, socket}
  end

  def handle_in("typing:stop", _payload, socket) do
    broadcast_from!(socket, "typing:stop", %{
      user_id: socket.assigns.user_id
    })
    {:noreply, socket}
  end

  # ── Device-to-device sync protocol ────────────────────────────────────

  def handle_in("sync.request", %{"scope" => scope}, socket) do
    user_id = socket.assigns.user_id
    device_id = socket.assigns.device_id

    payload = %{
      requesting_device_id: device_id,
      scope: scope
    }

    notify_other_devices(user_id, device_id, {:sync_request, payload})

    {:reply, :ok, socket}
  end

  def handle_in("sync.accept", %{"requesting_device_id" => requester_device_id}, socket) do
    user_id = socket.assigns.user_id
    provider_device_id = socket.assigns.device_id

    with {:ok, requester_pid} <- find_device_pid(user_id, requester_device_id) do
      SyncSession.create(user_id, requester_device_id, provider_device_id)

      send(requester_pid, {:sync_accepted, %{
        provider_device_id: provider_device_id,
        requesting_device_id: requester_device_id
      }})

      {:reply, :ok, socket}
    else
      :error ->
        {:reply, {:error, %{reason: "requester_device_offline"}}, socket}
    end
  end

  def handle_in("sync.accept", _payload, socket) do
    {:reply, {:error, %{reason: "missing_requesting_device_id"}}, socket}
  end

  def handle_in("sync.data", %{"target_device_id" => target_device_id, "chunk" => chunk}, socket) do
    user_id = socket.assigns.user_id
    provider_device_id = socket.assigns.device_id

    with {:ok, session} <- SyncSession.get(user_id, target_device_id),
         :ok <- ensure_sync_provider(session, provider_device_id),
         {:ok, pid} <- find_device_pid(user_id, target_device_id),
         :ok <- SyncSession.touch(user_id, target_device_id) do
      send(pid, {:sync_chunk, %{
        from_device_id: provider_device_id,
        target_device_id: target_device_id,
        chunk: chunk
      }})

      {:reply, :ok, socket}
    else
      {:error, :not_found} ->
        {:reply, {:error, %{reason: "no_active_sync_session"}}, socket}

      {:error, :unauthorized_provider} ->
        {:reply, {:error, %{reason: "sync_session_mismatch"}}, socket}

      :error ->
        {:reply, {:error, %{reason: "target_device_offline"}}, socket}
    end
  end

  def handle_in("sync.resume", %{"last_sequences" => last_sequences}, socket) do
    user_id = socket.assigns.user_id
    requester_device_id = socket.assigns.device_id

    with {:ok, session} <- SyncSession.get(user_id, requester_device_id),
         {:ok, provider_pid} <- find_device_pid(user_id, session.provider_device_id) do
      send(provider_pid, {:sync_resume, %{
        requesting_device_id: requester_device_id,
        last_sequences: last_sequences
      }})

      {:reply, :ok, socket}
    else
      {:error, :not_found} ->
        {:reply, {:error, %{reason: "no_active_sync_session"}}, socket}

      :error ->
        {:reply, {:error, %{reason: "provider_device_offline"}}, socket}
    end
  end

  def handle_in("sync.complete", %{"requesting_device_id" => requester_device_id}, socket) do
    user_id = socket.assigns.user_id
    device_id = socket.assigns.device_id

    with {:ok, session} <- SyncSession.get(user_id, requester_device_id),
         :ok <- ensure_sync_participant(session, device_id) do
      SyncSession.remove(user_id, requester_device_id)

      notify_sync_participants(user_id, session, {:sync_complete, %{
        requesting_device_id: requester_device_id,
        provider_device_id: session.provider_device_id,
        completed_by_device_id: device_id
      }})

      {:reply, :ok, socket}
    else
      {:error, :not_found} ->
        {:reply, {:error, %{reason: "no_active_sync_session"}}, socket}

      {:error, :unauthorized_participant} ->
        {:reply, {:error, %{reason: "sync_session_mismatch"}}, socket}
    end
  end

  def handle_in("sync.complete", _payload, socket) do
    {:reply, {:error, %{reason: "missing_requesting_device_id"}}, socket}
  end

  @impl true
  def handle_info({:sync_request, payload}, socket) do
    push(socket, "sync.request", payload)
    {:noreply, socket}
  end

  def handle_info({:sync_accepted, payload}, socket) do
    push(socket, "sync.accepted", payload)
    {:noreply, socket}
  end

  def handle_info({:sync_complete, payload}, socket) do
    push(socket, "sync.complete", payload)
    {:noreply, socket}
  end

  def handle_info({:sync_resume, payload}, socket) do
    push(socket, "sync.resume", payload)
    {:noreply, socket}
  end

  def handle_info({:sync_chunk, payload}, socket) do
    push(socket, "sync.data", payload)
    {:noreply, socket}
  end

  def handle_info({:relay_message, payload}, socket) do
    push(socket, "message.relayed", payload)
    {:noreply, socket}
  end

  # ── Handle relay messages from MessageRelay ───────────────────────────

  def handle_info(_msg, socket) do
    {:noreply, socket}
  end

  @impl true
  def terminate(_reason, socket) do
    # Unregister from DeviceRegistry when channel closes
    if socket.assigns[:topic_name] && String.starts_with?(socket.assigns.topic_name, "user:") do
      DeviceRegistry.unregister(socket.assigns.user_id, socket.assigns.device_id)
    end

    :ok
  end

  defp find_device_pid(user_id, device_id) do
    case DeviceRegistry.online_devices(user_id) |> List.keyfind(device_id, 0) do
      {^device_id, pid} -> {:ok, pid}
      nil -> :error
    end
  end

  defp notify_other_devices(user_id, excluded_device_id, message) do
    user_id
    |> DeviceRegistry.online_devices()
    |> Enum.reject(fn {device_id, _pid} -> device_id == excluded_device_id end)
    |> Enum.each(fn {_device_id, pid} -> send(pid, message) end)
  end

  defp notify_sync_participants(user_id, session, message) do
    [session.requester_device_id, session.provider_device_id]
    |> Enum.uniq()
    |> Enum.each(fn device_id ->
      case find_device_pid(user_id, device_id) do
        {:ok, pid} -> send(pid, message)
        :error -> :ok
      end
    end)
  end

  defp ensure_sync_provider(%{provider_device_id: provider_device_id}, provider_device_id), do: :ok
  defp ensure_sync_provider(_session, _provider_device_id), do: {:error, :unauthorized_provider}

  defp ensure_sync_participant(session, device_id)
       when device_id in [session.requester_device_id, session.provider_device_id],
       do: :ok

  defp ensure_sync_participant(_session, _device_id), do: {:error, :unauthorized_participant}
end
