defmodule VostokServer.Storage.ObjectStore.S3 do
  @moduledoc """
  S3-compatible object storage adapter.
  Works with AWS S3, Backblaze B2, Wasabi, MinIO, Hetzner Object Storage.
  """

  @behaviour VostokServer.Storage.ObjectStore

  require Logger

  @impl true
  def put(key, blob, content_type) do
    bucket = bucket()

    request =
      ExAws.S3.put_object(bucket, key, blob,
        content_type: content_type,
        content_length: byte_size(blob)
      )

    case ExAws.request(request, aws_config()) do
      {:ok, _response} ->
        {:ok, %{key: key, size: byte_size(blob)}}

      {:error, reason} ->
        Logger.error("[S3] PUT failed for #{key}: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @impl true
  def get(key) do
    request = ExAws.S3.get_object(bucket(), key)

    case ExAws.request(request, aws_config()) do
      {:ok, %{body: body}} ->
        {:ok, body}

      {:error, {:http_error, 404, _}} ->
        {:error, :not_found}

      {:error, reason} ->
        Logger.error("[S3] GET failed for #{key}: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @impl true
  def delete(key) do
    request = ExAws.S3.delete_object(bucket(), key)

    case ExAws.request(request, aws_config()) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def presigned_url(key, expires_in) do
    config = aws_config()

    case ExAws.S3.presigned_url(config, :get, bucket(), key, expires_in: expires_in) do
      {:ok, url} -> {:ok, url}
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def head(key) do
    request = ExAws.S3.head_object(bucket(), key)

    case ExAws.request(request, aws_config()) do
      {:ok, %{headers: headers}} ->
        size =
          headers
          |> Enum.find(fn {k, _} -> String.downcase(k) == "content-length" end)
          |> case do
            {_, v} ->
              case Integer.parse(v) do
                {n, _} -> n
                :error -> 0
              end
            nil -> 0
          end

        content_type =
          headers
          |> Enum.find(fn {k, _} -> String.downcase(k) == "content-type" end)
          |> case do
            {_, v} -> v
            nil -> "application/octet-stream"
          end

        {:ok, %{size: size, content_type: content_type}}

      {:error, {:http_error, 404, _}} ->
        {:error, :not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # ── Config ───────────────────────────────────────────────────────────

  defp bucket do
    object_config()[:bucket] || "vostok-media"
  end

  defp aws_config do
    config = object_config()

    base = [
      access_key_id: resolve_env(config[:access_key_id]),
      secret_access_key: resolve_env(config[:secret_access_key]),
      region: config[:region] || "us-east-1"
    ]

    case config[:endpoint] do
      nil -> base
      endpoint -> Keyword.put(base, :host, URI.parse(endpoint).host)
                  |> Keyword.put(:scheme, URI.parse(endpoint).scheme <> "://")
                  |> Keyword.put(:port, URI.parse(endpoint).port)
    end
  end

  defp object_config do
    Application.get_env(:vostok_server, VostokServer.Storage, [])
    |> Keyword.get(:object_store, [])
  end

  defp resolve_env({:system, var}), do: System.get_env(var) || ""
  defp resolve_env(value) when is_binary(value), do: value
  defp resolve_env(_), do: ""
end
