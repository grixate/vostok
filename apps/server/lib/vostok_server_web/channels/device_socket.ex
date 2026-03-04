defmodule VostokServerWeb.DeviceSocket do
  use Phoenix.Socket

  alias VostokServer.Auth

  channel "user:*", VostokServerWeb.TopicChannel
  channel "chat:*", VostokServerWeb.TopicChannel
  channel "presence:*", VostokServerWeb.TopicChannel
  channel "call:*", VostokServerWeb.TopicChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) when byte_size(token) > 0 do
    case Auth.authenticate_session_token(token) do
      {:ok, session} ->
        socket =
          socket
          |> assign(:device_token, token)
          |> assign(:device_id, session.device_id)
          |> assign(:user_id, session.device.user_id)

        {:ok, socket}

      :error ->
        :error
    end
  end

  def connect(_, _, _), do: :error

  @impl true
  def id(socket), do: "device_socket:#{socket.assigns.device_id}"
end
