defmodule VostokServerWeb.Plugs.RequestContext do
  @moduledoc """
  Attaches authenticated user/device context and client IP to Logger metadata
  so all log lines within a request carry correlation context.

  Must be placed after the Authenticate plug in the pipeline.
  """

  import Plug.Conn
  require Logger

  def init(opts), do: opts

  def call(conn, _opts) do
    meta = []

    meta =
      case conn.assigns[:current_user] do
        %{id: user_id} -> [{:user_id, user_id} | meta]
        _ -> meta
      end

    meta =
      case conn.assigns[:current_device] do
        %{id: device_id} -> [{:device_id, device_id} | meta]
        _ -> meta
      end

    meta =
      case conn.remote_ip do
        {a, b, c, d} -> [{:remote_ip, "#{a}.#{b}.#{c}.#{d}"} | meta]
        _ -> meta
      end

    Logger.metadata(meta)

    register_before_send(conn, fn conn ->
      case conn.private[:plug_request_start_time] do
        nil ->
          conn

        start_time ->
          duration = System.monotonic_time() - start_time
          duration_ms = System.convert_time_unit(duration, :native, :millisecond)
          Logger.metadata(duration_ms: duration_ms)
          conn
      end
    end)
  end
end
