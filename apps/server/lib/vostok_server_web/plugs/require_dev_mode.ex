defmodule VostokServerWeb.Plugs.RequireDevMode do
  @moduledoc "Returns 404 if the server is not in dev auth mode."

  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    auth_mode =
      Application.get_env(:vostok_server, :auth_mode) ||
        Application.get_env(:vostok_server, :registration_mode, "invite_only")

    if auth_mode == "dev" do
      conn
    else
      conn
      |> put_status(:not_found)
      |> Phoenix.Controller.json(%{error: "not_found", message: "Not found."})
      |> halt()
    end
  end
end
