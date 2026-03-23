defmodule VostokServerWeb.DeviceSocket do
  use Phoenix.Socket

  import Ecto.Query

  alias VostokServer.Auth
  alias VostokServer.Auth.Token
  alias VostokServer.Identity.{Device, User}
  alias VostokServer.Repo

  channel "user:*", VostokServerWeb.TopicChannel
  channel "chat:*", VostokServerWeb.TopicChannel
  channel "presence:*", VostokServerWeb.PresenceChannel
  channel "call:*", VostokServerWeb.TopicChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) when byte_size(token) > 0 do
    # Try JWT first, fall back to legacy device session token
    case Token.verify_access_token(token) do
      {:ok, claims} ->
        user = Repo.get(User, claims["sub"])

        if user && user.status == "active" do
          device = Repo.one(
            from(d in Device,
              where: d.user_id == ^user.id and is_nil(d.revoked_at),
              order_by: [desc: not is_nil(d.encryption_public_key), desc: d.inserted_at],
              limit: 1
            )
          )
          device_id = if device, do: device.id, else: user.id

          socket =
            socket
            |> assign(:device_token, token)
            |> assign(:device_id, device_id)
            |> assign(:user_id, user.id)
            |> assign(:username, user.username)

          {:ok, socket}
        else
          :error
        end

      {:error, _} ->
        # Fall back to legacy device session token
        case Auth.authenticate_session_token(token) do
          {:ok, session} ->
            legacy_user = Repo.get(User, session.device.user_id)
            socket =
              socket
              |> assign(:device_token, token)
              |> assign(:device_id, session.device_id)
              |> assign(:user_id, session.device.user_id)
              |> assign(:username, (legacy_user && legacy_user.username) || "unknown")

            {:ok, socket}

          :error ->
            :error
        end
    end
  end

  def connect(_, _, _), do: :error

  @impl true
  def id(socket), do: "device_socket:#{socket.assigns.device_id}"
end
