defmodule VostokServerWeb.Api.V1.ServerController do
  use VostokServerWeb, :controller

  import Ecto.Query
  alias VostokServer.Auth
  alias VostokServer.Repo
  alias VostokServer.Media.Upload
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

  def my_storage(conn, _params) do
    user_id = conn.assigns.current_user.id

    by_type =
      from(u in Upload,
        where: u.media_status == "available" and u.status == "completed",
        join: d in assoc(u, :uploader_device),
        where: d.user_id == ^user_id,
        group_by: u.media_kind,
        select: %{
          media_kind: u.media_kind,
          bytes: coalesce(sum(u.uploaded_byte_size), 0),
          count: count(u.id)
        }
      )
      |> Repo.all()

    total_bytes = Enum.reduce(by_type, 0, fn row, acc -> acc + (row.bytes || 0) end)
    total_files = Enum.reduce(by_type, 0, fn row, acc -> acc + row.count end)

    by_type_map =
      Map.new(by_type, fn row ->
        {row.media_kind, %{bytes: row.bytes || 0, count: row.count}}
      end)

    server_usage = HotCache.current_usage()
    server_max = HotCache.max_bytes()

    json(conn, %{
      usage_bytes: total_bytes,
      file_count: total_files,
      by_type: by_type_map,
      server_total_bytes: server_usage,
      server_max_bytes: server_max,
      server_usage_ratio: Float.round(server_usage / max(server_max, 1), 4)
    })
  end
end
