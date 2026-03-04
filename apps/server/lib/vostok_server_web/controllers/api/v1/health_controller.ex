defmodule VostokServerWeb.Api.V1.HealthController do
  use VostokServerWeb, :controller

  def show(conn, _params) do
    json(conn, %{
      status: "ok",
      api_version: "v1",
      timestamp: DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()
    })
  end
end
