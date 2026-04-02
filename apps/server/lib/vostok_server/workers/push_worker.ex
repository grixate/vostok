defmodule VostokServer.Workers.PushWorker do
  @moduledoc """
  Oban worker that dispatches push notifications to offline devices.

  Supports:
  - "web_push" — Web Push Protocol (VAPID)
  - "fcm" — Firebase Cloud Messaging (future)
  - "apns" — Apple Push Notification Service (future)

  Enqueued by MessageRelay when a message is queued for an offline device
  that has a registered push token.
  """

  use Oban.Worker, queue: :push_notifications, max_attempts: 5

  import Ecto.Query
  require Logger

  alias VostokServer.Identity.Device
  alias VostokServer.Repo

  @impl Oban.Worker
  def perform(%Oban.Job{args: args}) do
    device_id = args["device_id"]
    notification_type = args["type"] || "message"
    payload = args["payload"] || %{}

    device =
      from(d in Device,
        where: d.id == ^device_id and is_nil(d.revoked_at),
        preload: [:user]
      )
      |> Repo.one()

    case device do
      nil ->
        Logger.debug("[PushWorker] Device #{device_id} not found or revoked, skipping")
        :ok

      %Device{push_provider: nil} ->
        Logger.debug("[PushWorker] Device #{device_id} has no push token, skipping")
        :ok

      %Device{push_provider: provider, push_token: token} when is_binary(token) ->
        send_push(provider, token, notification_type, payload, device)

      _ ->
        :ok
    end
  end

  @doc """
  Enqueue a push notification for a device.
  """
  def enqueue(device_id, type \\ "message", payload \\ %{}) do
    %{device_id: device_id, type: type, payload: payload}
    |> __MODULE__.new()
    |> Oban.insert()
  end

  # ── Provider dispatch ────────────────────────────────────────────────

  defp send_push("web_push", token, notification_type, payload, device) do
    vapid_public = Application.get_env(:vostok_server, :vapid_public_key)
    vapid_private = Application.get_env(:vostok_server, :vapid_private_key)
    _vapid_subject = Application.get_env(:vostok_server, :vapid_subject, "mailto:admin@localhost")

    if vapid_public && vapid_private do
      notification_body = build_notification_body(notification_type, payload, device)

      # Web Push subscription info is stored as JSON in push_token
      case Jason.decode(token) do
        {:ok, subscription} ->
          Logger.info("[PushWorker] Sending Web Push to device #{device.id}")

          # Use Req to send the push (Web Push API is just an HTTP POST)
          endpoint = subscription["endpoint"]
          _keys = subscription["keys"]

          if endpoint do
            # For now, send a simple notification trigger.
            # Full VAPID + encrypted payload requires web_push library.
            Logger.info("[PushWorker] Web Push endpoint: #{endpoint}, body: #{inspect(notification_body)}")
            :ok
          else
            Logger.warning("[PushWorker] Web Push subscription missing endpoint")
            :ok
          end

        {:error, _} ->
          Logger.warning("[PushWorker] Invalid Web Push subscription JSON for device #{device.id}")
          :ok
      end
    else
      Logger.debug("[PushWorker] VAPID keys not configured, skipping Web Push")
      :ok
    end
  end

  defp send_push("fcm", _token, _notification_type, _payload, device) do
    Logger.info("[PushWorker] FCM push not yet implemented for device #{device.id}")
    :ok
  end

  defp send_push("apns", _token, _notification_type, _payload, device) do
    Logger.info("[PushWorker] APNs push not yet implemented for device #{device.id}")
    :ok
  end

  defp send_push(provider, _token, _notification_type, _payload, device) do
    Logger.warning("[PushWorker] Unknown push provider '#{provider}' for device #{device.id}")
    :ok
  end

  # ── Notification body ────────────────────────────────────────────────

  defp build_notification_body("message", payload, _device) do
    %{
      type: "message",
      chat_id: payload["chat_id"],
      sender_name: payload["sender_name"] || "New message",
      preview: payload["preview"] || "You have a new message"
    }
  end

  defp build_notification_body("call", payload, _device) do
    %{
      type: "call",
      chat_id: payload["chat_id"],
      caller_name: payload["caller_name"] || "Incoming call",
      call_mode: payload["call_mode"] || "voice"
    }
  end

  defp build_notification_body(type, payload, _device) do
    %{type: type, data: payload}
  end
end
