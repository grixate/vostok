defmodule VostokServerWeb.Plugs.AuthenticatedDevice do
  @moduledoc """
  Authenticates API requests using the bearer session token issued to a device.
  """

  import Plug.Conn

  alias VostokServer.Auth
  alias VostokServer.Repo

  def init(opts), do: opts

  def call(conn, _opts) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         {:ok, session} <- Auth.authenticate_session_token(token) do
      session = Repo.preload(session, device: :user)

      conn
      |> assign(:current_session, session)
      |> assign(:current_device, session.device)
      |> assign(:current_user, session.device.user)
    else
      _ ->
        conn
        |> put_status(:unauthorized)
        |> Phoenix.Controller.json(%{
          error: "unauthorized",
          message: "A valid device bearer token is required."
        })
        |> halt()
    end
  end
end
