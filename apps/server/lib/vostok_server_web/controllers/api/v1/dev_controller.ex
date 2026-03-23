defmodule VostokServerWeb.Api.V1.DevController do
  use VostokServerWeb, :controller

  alias VostokServer.Auth
  alias VostokServer.Identity.User
  alias VostokServer.Repo

  import Ecto.Query

  def quick_login(conn, %{"username" => username}) do
    password = "password"

    # Check if user exists first to avoid triggering rate limiter
    case Repo.one(from(u in User, where: u.username == ^username, limit: 1)) do
      %User{} ->
        # User exists — log in
        case Auth.login(username, password) do
          {:ok, result} ->
            json(conn, %{
              access_token: result.access_token,
              refresh_token: result.refresh_token,
              user: serialize_user(result.user)
            })

          {:error, _} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{error: "failed", message: "Could not login. Password may have been changed."})
        end

      nil ->
        # User doesn't exist — create and log in
        params = %{
          "username" => username,
          "password" => password,
          "display_name" => username
        }

        case Auth.register(params) do
          {:ok, result} ->
            conn
            |> put_status(:created)
            |> json(%{
              access_token: result.access_token,
              refresh_token: result.refresh_token,
              user: serialize_user(result.user)
            })

          {:error, _} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{error: "failed", message: "Could not create user."})
        end
    end
  end

  def quick_login(conn, _params) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: "validation", message: "username is required."})
  end

  def bulk_create(conn, %{"count" => count}) when is_integer(count) and count > 0 and count <= 50 do
    users =
      Enum.map(1..count, fn i ->
        username = "test_user_#{i}"
        params = %{"username" => username, "password" => "password", "display_name" => "Test User #{i}"}

        case Auth.register(params) do
          {:ok, %{user: user}} -> %{username: user.username, password: "password"}
          {:error, _} -> %{username: username, password: "password", error: "already exists"}
        end
      end)

    json(conn, users)
  end

  def bulk_create(conn, _params) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: "validation", message: "count is required (1-50)."})
  end

  defp serialize_user(user) do
    %{
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      temp_password: user.temp_password
    }
  end
end
