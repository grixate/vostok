defmodule VostokServerWeb.Api.V1.KeyBackupController do
  use VostokServerWeb, :controller

  alias VostokServer.Keys.EncryptedBackup
  alias VostokServer.Repo

  # 50MB max backup size — Signal Protocol state is typically <1MB
  @max_blob_bytes 50 * 1024 * 1024

  def upload(conn, %{"encrypted_blob" => blob_b64, "blob_hash" => blob_hash} = params) do
    user_id = conn.assigns.current_user.id
    version = Map.get(params, "version", 1)
    normalized_blob_hash = normalize_blob_hash(blob_hash)

    case {Base.decode64(blob_b64), normalized_blob_hash} do
      {{:ok, _blob}, nil} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "invalid_blob_hash", message: "blob_hash must be a 64-character hex SHA-256 digest"})

      {{:ok, blob}, _computed_hash} when byte_size(blob) > @max_blob_bytes ->
        conn
        |> put_status(:request_entity_too_large)
        |> json(%{error: "blob_too_large", message: "Backup exceeds #{div(@max_blob_bytes, 1_048_576)}MB limit"})

      {{:ok, blob}, computed_hash} ->
        if computed_hash != sha256_hex(blob) do
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: "blob_hash_mismatch", message: "blob_hash does not match the encrypted backup contents"})
        else
          attrs = %{
            user_id: user_id,
            encrypted_blob: blob,
            blob_hash: computed_hash,
            version: version
          }

          # Upsert — replace existing backup for this user
          case Repo.get_by(EncryptedBackup, user_id: user_id) do
            nil ->
              %EncryptedBackup{}
              |> EncryptedBackup.changeset(attrs)
              |> Repo.insert()

            existing ->
              existing
              |> EncryptedBackup.changeset(attrs)
              |> Repo.update()
          end
          |> case do
            {:ok, backup} ->
              json(conn, %{
                id: backup.id,
                blob_hash: backup.blob_hash,
                version: backup.version,
                updated_at: DateTime.to_iso8601(backup.updated_at)
              })

            {:error, changeset} ->
              conn
              |> put_status(:unprocessable_entity)
              |> json(%{error: "validation", message: format_errors(changeset)})
          end
        end

      {:error, _computed_hash} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "invalid_base64", message: "encrypted_blob must be valid base64"})
    end
  end

  def upload(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "missing_params", message: "encrypted_blob and blob_hash are required"})
  end

  def download(conn, _params) do
    user_id = conn.assigns.current_user.id

    case Repo.get_by(EncryptedBackup, user_id: user_id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "not_found", message: "No key backup found"})

      backup ->
        json(conn, %{
          id: backup.id,
          encrypted_blob: Base.encode64(backup.encrypted_blob),
          blob_hash: backup.blob_hash,
          version: backup.version,
          updated_at: DateTime.to_iso8601(backup.updated_at)
        })
    end
  end

  def delete(conn, _params) do
    user_id = conn.assigns.current_user.id

    case Repo.get_by(EncryptedBackup, user_id: user_id) do
      nil ->
        json(conn, %{deleted: false})

      backup ->
        Repo.delete!(backup)
        json(conn, %{deleted: true})
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
    |> Enum.map(fn {field, msgs} -> "#{field}: #{Enum.join(msgs, ", ")}" end)
    |> Enum.join("; ")
  end

  defp normalize_blob_hash(hash) when is_binary(hash) do
    normalized = hash |> String.trim() |> String.downcase()

    if String.match?(normalized, ~r/\A[a-f0-9]{64}\z/) do
      normalized
    else
      nil
    end
  end

  defp normalize_blob_hash(_hash), do: nil

  defp sha256_hex(blob) when is_binary(blob) do
    :crypto.hash(:sha256, blob)
    |> Base.encode16(case: :lower)
  end
end
