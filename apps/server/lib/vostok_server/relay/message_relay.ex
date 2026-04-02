defmodule VostokServer.Relay.MessageRelay do
  @moduledoc """
  Central message routing GenServer. All incoming messages (from clients or federation)
  flow through here to be routed to local devices or federated peers.
  """

  use GenServer
  require Logger

  alias VostokServer.Relay.DeviceRegistry

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @doc """
  Route a message envelope to its destination(s).

  Envelope shape:
    %{
      message_id: binary,
      chat_id: binary,
      sender_user_id: binary,
      sender_device_id: binary,
      recipient_user_ids: [binary],       # All users who should receive this
      per_device_ciphertext: %{device_id => binary}  # Optional: per-device envelopes
    }
  """
  def relay(envelope) do
    GenServer.cast(__MODULE__, {:relay, envelope})
  end

  @doc """
  Deliver a message directly to a specific device if it's online.
  Returns :ok if delivered, :offline if not.
  """
  def deliver_to_device(user_id, device_id, message_payload) do
    case DeviceRegistry.online_devices(user_id) do
      devices ->
        case List.keyfind(devices, device_id, 0) do
          {^device_id, pid} ->
            send(pid, {:relay_message, message_payload})
            :ok

          nil ->
            :offline
        end
    end
  end

  @doc """
  Broadcast a message to all online devices for a user.
  Returns the list of device_ids that received it.
  """
  def broadcast_to_user(user_id, message_payload) do
    devices = DeviceRegistry.online_devices(user_id)

    for {_device_id, pid} <- devices do
      send(pid, {:relay_message, message_payload})
    end

    Enum.map(devices, &elem(&1, 0))
  end

  # ── GenServer callbacks ──────────────────────────────────────────────

  @impl true
  def init(:ok) do
    {:ok, %{}}
  end

  @impl true
  def handle_cast({:relay, envelope}, state) do
    recipient_user_ids = Map.get(envelope, :recipient_user_ids, [])

    # Batch-fetch all device IDs for all recipients in one query
    all_devices_by_user = list_all_device_ids_grouped(recipient_user_ids)

    for user_id <- recipient_user_ids do
      online_devices = DeviceRegistry.online_devices(user_id)
      online_device_ids = MapSet.new(Enum.map(online_devices, &elem(&1, 0)))

      for {device_id, pid} <- online_devices do
        payload = build_device_payload(envelope, device_id)
        send(pid, {:relay_message, payload})
      end

      # Enqueue push notifications for offline devices
      all_device_ids = Map.get(all_devices_by_user, user_id, [])
      offline_device_ids = Enum.reject(all_device_ids, &MapSet.member?(online_device_ids, &1))

      for device_id <- offline_device_ids do
        VostokServer.Workers.PushWorker.enqueue(device_id, "message", %{
          "chat_id" => envelope[:chat_id],
          "message_id" => envelope[:message_id]
        })
      end

      online_count = length(online_devices)
      offline_count = length(offline_device_ids)
      if online_count > 0 || offline_count > 0 do
        Logger.debug("[MessageRelay] Message #{envelope[:message_id]}: #{online_count} online, #{offline_count} push for user #{user_id}")
      end
    end

    {:noreply, state}
  end

  defp list_all_device_ids_grouped(user_ids) when user_ids == [], do: %{}

  defp list_all_device_ids_grouped(user_ids) do
    import Ecto.Query

    from(d in VostokServer.Identity.Device,
      where: d.user_id in ^user_ids and is_nil(d.revoked_at),
      select: {d.user_id, d.id}
    )
    |> VostokServer.Repo.all()
    |> Enum.group_by(&elem(&1, 0), &elem(&1, 1))
  end

  defp build_device_payload(envelope, device_id) do
    per_device = Map.get(envelope, :per_device_ciphertext, %{})

    %{
      message_id: envelope[:message_id],
      chat_id: envelope[:chat_id],
      sender_user_id: envelope[:sender_user_id],
      sender_device_id: envelope[:sender_device_id],
      ciphertext: Map.get(per_device, device_id, envelope[:ciphertext])
    }
  end
end
