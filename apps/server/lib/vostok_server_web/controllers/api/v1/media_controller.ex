defmodule VostokServerWeb.Api.V1.MediaController do
  use VostokServerWeb, :controller

  alias VostokServer.Media

  def create_upload(conn, params) do
    case Media.create_upload(conn.assigns.current_device.id, params) do
      {:ok, upload} ->
        conn
        |> put_status(:created)
        |> json(%{upload: upload})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def upload_part(conn, %{"id" => upload_id} = params) do
    case Media.append_upload_part(upload_id, conn.assigns.current_device.id, params) do
      {:ok, upload} ->
        json(conn, %{upload: upload})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def complete_upload(conn, %{"id" => upload_id} = params) do
    case Media.complete_upload(upload_id, conn.assigns.current_device.id, params) do
      {:ok, upload} ->
        json(conn, %{upload: upload})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def upload_status(conn, %{"id" => upload_id}) do
    case Media.fetch_upload_state(upload_id, conn.assigns.current_device.id) do
      {:ok, upload} ->
        json(conn, %{upload: upload})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def show(conn, %{"id" => upload_id}) do
    case Media.fetch_upload(upload_id) do
      {:ok, upload} ->
        json(conn, %{upload: upload})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def link_metadata(conn, params) do
    case Media.fetch_link_metadata(params) do
      {:ok, metadata} ->
        json(conn, %{metadata: metadata})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  defp render_error(conn, :not_found, message) do
    conn
    |> put_status(:not_found)
    |> json(%{error: "not_found", message: message})
  end

  defp render_error(conn, :unauthorized, message) do
    conn
    |> put_status(:unauthorized)
    |> json(%{error: "unauthorized", message: message})
  end

  defp render_error(conn, _kind, message) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: "validation", message: message})
  end
end
