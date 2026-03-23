defmodule VostokServerWeb.Plugs.RequireAdmin do
  @moduledoc "Returns 403 if the current user is not an admin."

  import Plug.Conn

  def init(opts), do: opts

  def call(%{assigns: %{current_user: %{role: "admin"}}} = conn, _opts), do: conn

  def call(conn, _opts) do
    conn
    |> put_status(:forbidden)
    |> Phoenix.Controller.json(%{error: "forbidden", message: "Admin access required."})
    |> halt()
  end
end
