defmodule VostokServerWeb.Api.V1.AuthController do
  use VostokServerWeb, :controller

  alias Ecto.Changeset
  alias VostokServer.Auth

  def challenge(conn, %{"device_id" => device_id}) do
    case Auth.issue_challenge(device_id) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {kind, message}} ->
        render_error(conn, status_for(kind), kind, message)
    end
  end

  def challenge(conn, _params) do
    render_error(
      conn,
      :unprocessable_entity,
      :validation,
      "device_id is required to request a challenge."
    )
  end

  def verify(conn, %{
        "device_id" => device_id,
        "challenge_id" => challenge_id,
        "signature" => signature
      }) do
    case Auth.verify_challenge(device_id, challenge_id, signature) do
      {:ok, session} ->
        json(conn, %{session: session})

      {:error, %Changeset{} = changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          error: "validation_failed",
          details: Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
        })

      {:error, {kind, message}} ->
        render_error(conn, status_for(kind), kind, message)
    end
  end

  def verify(conn, _params) do
    render_error(
      conn,
      :unprocessable_entity,
      :validation,
      "device_id, challenge_id, and signature are required."
    )
  end

  defp status_for(kind) when kind in [:not_found], do: :not_found
  defp status_for(kind) when kind in [:unauthorized], do: :unauthorized
  defp status_for(kind) when kind in [:registration_closed, :invite_required], do: :forbidden
  defp status_for(_kind), do: :unprocessable_entity

  defp render_error(conn, status, kind, message) do
    conn
    |> put_status(status)
    |> json(%{error: Atom.to_string(kind), message: message})
  end
end
