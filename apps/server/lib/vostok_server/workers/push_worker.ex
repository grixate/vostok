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
    vapid_subject = Application.get_env(:vostok_server, :vapid_subject, "mailto:admin@localhost")

    if vapid_public && vapid_private do
      notification_body = build_notification_body(notification_type, payload, device)
      json_payload = Jason.encode!(notification_body)

      case Jason.decode(token) do
        {:ok, subscription} ->
          case VostokServer.Push.WebPush.send_notification(
                 subscription,
                 json_payload,
                 vapid_public,
                 vapid_private,
                 vapid_subject
               ) do
            :ok ->
              Logger.info("[PushWorker] Web Push sent to device #{device.id}")
              :ok

            {:error, :subscription_expired} ->
              Logger.info("[PushWorker] Subscription expired for device #{device.id}, clearing token")
              clear_push_token(device)
              :ok

            {:error, :rate_limited} ->
              Logger.warning("[PushWorker] Rate limited by push service for device #{device.id}")
              {:error, "Rate limited by push service"}

            {:error, reason} ->
              Logger.warning("[PushWorker] Web Push failed for device #{device.id}: #{inspect(reason)}")
              {:error, inspect(reason)}
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

  defp clear_push_token(device) do
    device
    |> Ecto.Changeset.change(%{push_provider: nil, push_token: nil})
    |> Repo.update()
  end
end
