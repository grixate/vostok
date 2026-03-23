defmodule VostokServerWeb.PresenceChannel do
  use VostokServerWeb, :channel

  alias VostokServerWeb.Presence
  alias VostokServer.Identity.User
  alias VostokServer.Repo

  @impl true
  def join("presence:lobby", _params, socket) do
    send(self(), :after_join)
    {:ok, socket}
  end

  def join(_topic, _params, _socket), do: {:error, %{reason: "unsupported_topic"}}

  @impl true
  def handle_info(:after_join, socket) do
    user_id = socket.assigns.user_id

    # Track this user in the presence system
    {:ok, _} =
      Presence.track(socket, user_id, %{
        device_id: socket.assigns.device_id,
        online_at: System.system_time(:second)
      })

    # Push current presence state to the joining client
    push(socket, "presence_state", Presence.list(socket))

    # Update last_seen_at on the user record
    touch_last_seen(user_id)

    {:noreply, socket}
  end

  @impl true
  def terminate(_reason, socket) do
    # Update last_seen_at when disconnecting so "last seen" is accurate.
    # Wrap in try/rescue — socket assigns may be unavailable on abnormal
    # terminations (e.g. transport crash before join completes).
    try do
      touch_last_seen(socket.assigns.user_id)
    rescue
      _ -> :ok
    end

    :ok
  end

  defp touch_last_seen(user_id) do
    import Ecto.Query

    from(u in User, where: u.id == ^user_id)
    |> Repo.update_all(set: [last_seen_at: DateTime.utc_now()])
  end
end
