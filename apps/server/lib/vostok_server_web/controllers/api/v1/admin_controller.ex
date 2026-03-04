defmodule VostokServerWeb.Api.V1.AdminController do
  use VostokServerWeb, :controller

  import Ecto.Query

  alias VostokServer.Federation
  alias VostokServer.Federation.Peer
  alias VostokServer.Identity.User
  alias VostokServer.Media.Upload
  alias VostokServer.Messaging.Chat
  alias VostokServer.Repo

  def overview(conn, _params) do
    json(conn, %{
      overview: %{
        users: Repo.aggregate(User, :count, :id),
        chats: Repo.aggregate(Chat, :count, :id),
        media_uploads: Repo.aggregate(Upload, :count, :id),
        federation_peers: Repo.aggregate(Peer, :count, :id),
        pending_federation_peers:
          Peer
          |> where([peer], peer.status == "pending")
          |> Repo.aggregate(:count, :id)
      }
    })
  end

  def federation_peers(conn, _params) do
    json(conn, %{peers: Federation.list_peers()})
  end

  def create_federation_peer(conn, params) do
    case Federation.create_peer(params) do
      {:ok, peer} ->
        conn
        |> put_status(:created)
        |> json(%{peer: peer})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def update_federation_peer_status(conn, %{"peer_id" => peer_id, "status" => status}) do
    case Federation.update_peer_status(peer_id, status) do
      {:ok, peer} ->
        json(conn, %{peer: peer})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def update_federation_peer_status(conn, _params) do
    render_error(conn, :validation, "status is required.")
  end

  def federation_peer_heartbeat(conn, %{"peer_id" => peer_id}) do
    case Federation.record_peer_heartbeat(peer_id) do
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

  defp render_error(conn, _kind, message) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: "unknown", message: message})
  end
end
