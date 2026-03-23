defmodule VostokServerWeb.Api.V1.ServerController do
  use VostokServerWeb, :controller

  alias VostokServer.Auth
  alias VostokServer.Storage.HotCache

  def info(conn, _params) do
    json(conn, Auth.get_server_info())
  end

  def storage_usage(conn, _params) do
    usage = HotCache.current_usage()
    max = HotCache.max_bytes()

    json(conn, %{
      usage_bytes: usage,
      max_bytes: max,
      usage_ratio: Float.round(usage / max(max, 1), 4)
    })
  end
end
