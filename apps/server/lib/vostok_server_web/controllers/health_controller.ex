defmodule VostokServerWeb.HealthController do
  use VostokServerWeb, :controller

  def show(conn, _params) do
    json(conn, %{
      status: "ok",
      service: "vostok-server",
      timestamp: DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()
    })
  end
end
