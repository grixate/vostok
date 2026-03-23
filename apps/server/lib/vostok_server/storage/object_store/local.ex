defmodule VostokServer.Storage.ObjectStore.Local do
  @moduledoc """
  Local filesystem adapter for object storage.
  Uses a separate directory (e.g. second disk or NFS mount) as cold storage.
  """

  @behaviour VostokServer.Storage.ObjectStore

  @impl true
  def put(key, blob, _content_type) do
    path = full_path(key)
    File.mkdir_p!(Path.dirname(path))

    case File.write(path, blob) do
      :ok -> {:ok, %{key: key, size: byte_size(blob)}}
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def get(key) do
    case File.read(full_path(key)) do
      {:ok, blob} -> {:ok, blob}
      {:error, :enoent} -> {:error, :not_found}
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def delete(key) do
    case File.rm(full_path(key)) do
      :ok -> :ok
      {:error, :enoent} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def presigned_url(_key, _expires_in) do
    {:error, :not_supported}
  end

  @impl true
  def head(key) do
    case File.stat(full_path(key)) do
      {:ok, %{size: size}} ->
        {:ok, %{size: size, content_type: "application/octet-stream"}}

      {:error, :enoent} ->
        {:error, :not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp full_path(key) do
    base = Path.expand(object_config()[:base_path] || "/var/lib/vostok/media/cold")
    resolved = Path.expand(Path.join(base, key))

    # Prevent path traversal — resolved path must stay within base
    if String.starts_with?(resolved, base <> "/") do
      resolved
    else
      raise "Path traversal detected: #{key} resolves outside base directory"
    end
  end

  defp object_config do
    Application.get_env(:vostok_server, VostokServer.Storage, [])
    |> Keyword.get(:object_store, [])
  end
end
