defmodule VostokServerWeb.Plugs.Authenticate do
  @moduledoc """
  Authenticates API requests using JWT access tokens.
  Falls back to legacy device session tokens for backwards compatibility.
  """

  import Plug.Conn

  import Ecto.Query

  alias VostokServer.Auth
  alias VostokServer.Auth.Token
  alias VostokServer.Identity.Device
  alias VostokServer.Repo

  def init(opts), do: opts

  def call(conn, _opts) do
    case get_req_header(conn, "authorization") do
      ["Bearer " <> token] ->
        authenticate_token(conn, token)

      _ ->
        unauthorized(conn)
    end
  end

  defp authenticate_token(conn, token) do
    # Try JWT first, fall back to legacy device session token
    case Token.verify_access_token(token) do
      {:ok, claims} ->
        user = Repo.get(VostokServer.Identity.User, claims["sub"])

        if user && user.status == "active" do
          # Load the user's most capable device — prefer one with encryption
          # keys (from linkDevice) over auto-created placeholder devices.
          device = Repo.one(
            from(d in Device,
              where: d.user_id == ^user.id and is_nil(d.revoked_at),
              order_by: [desc: not is_nil(d.encryption_public_key), desc: d.inserted_at],
              limit: 1
            )
          )

          conn
          |> assign(:current_user, user)
          |> assign(:current_device, device)
          |> assign(:auth_method, :jwt)
        else
          unauthorized(conn)
        end

      {:error, _} ->
        # Fall back to legacy device session token
        case Auth.authenticate_session_token(token) do
          {:ok, session} ->
            session = Repo.preload(session, device: :user)

            conn
            |> assign(:current_session, session)
            |> assign(:current_device, session.device)
            |> assign(:current_user, session.device.user)
            |> assign(:auth_method, :device_session)

          :error ->
            unauthorized(conn)
        end
    end
  end

  defp unauthorized(conn) do
    conn
    |> put_status(:unauthorized)
    |> Phoenix.Controller.json(%{error: "unauthorized", message: "A valid bearer token is required."})
    |> halt()
  end
end
