defmodule VostokServer.Federation do
  @moduledoc """
  Stage 6 federation admin scaffold.
  """

  alias VostokServer.Federation.Peer
  alias VostokServer.Repo

  def list_peers do
    Peer
    |> Repo.all()
    |> Enum.sort_by(& &1.inserted_at, {:desc, DateTime})
    |> Enum.map(&present_peer/1)
  end

  def create_peer(attrs) when is_map(attrs) do
    with {:ok, normalized} <- normalize_peer_attrs(attrs) do
      %Peer{}
      |> Peer.changeset(normalized)
      |> Repo.insert()
      |> case do
        {:ok, peer} -> {:ok, present_peer(peer)}
        {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
      end
    end
  end

  def update_peer_status(peer_id, status) when is_binary(peer_id) do
    with %Peer{} = peer <- Repo.get(Peer, peer_id),
         {:ok, normalized_status} <- normalize_status(status) do
      peer
      |> Peer.changeset(%{
        status: normalized_status,
        last_error: nil
      })
      |> Repo.update()
      |> case do
        {:ok, updated_peer} -> {:ok, present_peer(updated_peer)}
        {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
      end
    else
      nil ->
        {:error, {:not_found, "Federation peer not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def record_peer_heartbeat(peer_id) when is_binary(peer_id) do
    with %Peer{} = peer <- Repo.get(Peer, peer_id) do
      peer
      |> Peer.changeset(%{
        status: "active",
        last_error: nil,
        last_seen_at: DateTime.utc_now()
      })
      |> Repo.update()
      |> case do
        {:ok, updated_peer} -> {:ok, present_peer(updated_peer)}
        {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
      end
    else
      nil ->
        {:error, {:not_found, "Federation peer not found."}}
    end
  end

  defp normalize_peer_attrs(attrs) do
    domain = attrs |> Map.get("domain") |> normalize_string()
    display_name = attrs |> Map.get("display_name") |> normalize_string()

    if is_nil(domain) do
      {:error, {:validation, "domain is required."}}
    else
      {:ok,
       %{
         domain: domain,
         display_name: display_name,
         status: "pending"
       }}
    end
  end

  defp normalize_status(status) when is_binary(status) do
    case normalize_string(status) do
      "pending" = normalized_status -> {:ok, normalized_status}
      "active" = normalized_status -> {:ok, normalized_status}
      "disabled" = normalized_status -> {:ok, normalized_status}
      _ -> {:error, {:validation, "status must be pending, active, or disabled."}}
    end
  end

  defp normalize_status(_),
    do: {:error, {:validation, "status must be pending, active, or disabled."}}

  defp present_peer(%Peer{} = peer) do
    %{
      id: peer.id,
      domain: peer.domain,
      display_name: peer.display_name,
      status: peer.status,
      last_error: peer.last_error,
      last_seen_at: iso_or_nil(peer.last_seen_at),
      inserted_at: iso_or_nil(peer.inserted_at),
      updated_at: iso_or_nil(peer.updated_at)
    }
  end

  defp normalize_string(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_string(_), do: nil

  defp format_changeset_error(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
    |> Enum.map(fn {field, [message | _]} -> "#{field} #{message}" end)
    |> List.first()
    |> Kernel.||("The federation peer could not be saved.")
  end

  defp iso_or_nil(nil), do: nil
  defp iso_or_nil(%DateTime{} = value), do: DateTime.to_iso8601(value)
end
