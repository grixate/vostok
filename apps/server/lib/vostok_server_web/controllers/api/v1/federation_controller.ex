defmodule VostokServerWeb.Api.V1.FederationController do
  use VostokServerWeb, :controller

  alias VostokServer.Federation.EnvelopeCodec
  alias VostokServer.Federation

  def ingest_delivery(conn, params) do
    peer_data = Plug.Conn.get_peer_data(conn)

    with {:ok, conn, delivery_params} <- decode_ingest_params(conn, params) do
      case Federation.receive_delivery(delivery_params, peer_data: peer_data) do
        {:ok, delivery_job} ->
          conn
          |> put_status(:accepted)
          |> json(%{delivery: delivery_job})

        {:error, {kind, message}} ->
          render_error(conn, kind, message)
      end
    else
      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def accept_peer_invite(conn, params) do
    case Federation.accept_peer_invite(params) do
      {:ok, peer} ->
        json(conn, %{peer: peer})

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

  defp decode_ingest_params(conn, params) when is_map(params) do
    content_type = conn |> get_req_header("content-type") |> List.first() |> normalize_string()

    cond do
      protobuf_content_type?(content_type) ->
        with {:ok, conn, body} <- read_full_body(conn, []),
             :ok <- ensure_non_empty_body(body),
             {:ok, decoded_params} <- EnvelopeCodec.decode_protobuf(body) do
          {:ok, conn, decoded_params}
        end

      true ->
        {:ok, conn, params}
    end
  end

  defp read_full_body(conn, chunks) do
    case Plug.Conn.read_body(conn) do
      {:ok, chunk, conn} ->
        {:ok, conn, IO.iodata_to_binary(Enum.reverse([chunk | chunks]))}

      {:more, chunk, conn} ->
        read_full_body(conn, [chunk | chunks])

      {:error, _reason} ->
        {:error, {:validation, "Could not read federation request body."}}
    end
  end

  defp ensure_non_empty_body(body) when is_binary(body) do
    if byte_size(body) > 0 do
      :ok
    else
      {:error, {:validation, "Federation protobuf body is empty."}}
    end
  end

  defp protobuf_content_type?(value) when is_binary(value) do
    downcased = String.downcase(value)
    String.starts_with?(downcased, EnvelopeCodec.protobuf_content_type())
  end

  defp protobuf_content_type?(_value), do: false

  defp normalize_string(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_string(_), do: nil
end
