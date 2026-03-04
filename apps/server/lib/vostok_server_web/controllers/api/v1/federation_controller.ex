defmodule VostokServerWeb.Api.V1.FederationController do
  use VostokServerWeb, :controller

  alias VostokServer.Federation

  def ingest_delivery(conn, params) do
    peer_data = Plug.Conn.get_peer_data(conn)

    case Federation.receive_delivery(params, peer_data: peer_data) do
      {:ok, delivery_job} ->
        conn
        |> put_status(:accepted)
        |> json(%{delivery: delivery_job})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  defp render_error(conn, :not_found, message) do
    conn
    |> put_status(:not_found)
    |> json(%{error: "not_found", message: message})
  end

  defp render_error(conn, :validation, message) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: "validation", message: message})
  end

  defp render_error(conn, :unauthorized, message) do
    conn
    |> put_status(:unauthorized)
    |> json(%{error: "unauthorized", message: message})
  end

  defp render_error(conn, _kind, message) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: "unknown", message: message})
  end
end
