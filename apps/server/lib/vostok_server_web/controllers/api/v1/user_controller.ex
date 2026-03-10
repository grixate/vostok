defmodule VostokServerWeb.Api.V1.UserController do
  use VostokServerWeb, :controller

  alias VostokServer.Identity

  def index(conn, _params) do
    users = Identity.list_all_users()
    json(conn, %{users: users})
  end
end
