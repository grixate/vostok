defmodule VostokServer.Storage.HotCache do
  @moduledoc """
  Manages the local filesystem hot cache for media blobs.
  Files are stored as `{media_id}.enc` in the configured directory.
  """

  use GenServer

  require Logger

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # ── Public API ────────────────────────────────────────────────────────

  @doc "Write an encrypted blob to the hot cache. Returns the file path."
  def put(media_id, blob) when is_binary(media_id) and is_binary(blob) do
    path = file_path(media_id)
    dir = Path.dirname(path)
    File.mkdir_p!(dir)

    case File.write(path, blob) do
      :ok ->
        {:ok, path}

      {:error, reason} ->
        Logger.error("[HotCache] Failed to write #{media_id}: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc "Read an encrypted blob from the hot cache."
  def get(media_id) when is_binary(media_id) do
    path = file_path(media_id)

    case File.read(path) do
      {:ok, blob} -> {:ok, blob}
      {:error, :enoent} -> {:error, :not_found}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Delete a blob from the hot cache."
  def delete(media_id) when is_binary(media_id) do
    path = file_path(media_id)

    case File.rm(path) do
      :ok -> :ok
      {:error, :enoent} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Check if a blob exists in the hot cache."
  def exists?(media_id) when is_binary(media_id) do
    File.exists?(file_path(media_id))
  end

  @doc "Get total bytes used by the hot cache."
  def current_usage do
    dir = cache_dir()

    if File.dir?(dir) do
      dir
      |> File.ls!()
      |> Enum.reduce(0, fn filename, acc ->
        path = Path.join(dir, filename)

        case File.stat(path) do
          {:ok, %{size: size}} -> acc + size
          _ -> acc
        end
      end)
    else
      0
    end
  end

  @doc "Get the maximum configured cache size in bytes."
  def max_bytes do
    config()[:hot_cache_max_bytes] || 50_000_000_000
  end

  @doc "Get usage as a percentage (0.0 to 1.0)."
  def usage_ratio do
    current_usage() / max(max_bytes(), 1)
  end

  @doc "Returns the absolute file path for a media ID."
  def file_path(media_id) do
    Path.join(cache_dir(), "#{media_id}.enc")
  end

  # ── GenServer callbacks ───────────────────────────────────────────────

  @impl true
  def init(_opts) do
    dir = cache_dir()
    File.mkdir_p!(dir)
    Logger.info("[HotCache] Initialized at #{dir}")
    {:ok, %{dir: dir}}
  end

  # ── Private ───────────────────────────────────────────────────────────

  defp cache_dir do
    config()[:hot_cache_dir] || Path.join(Application.app_dir(:vostok_server, "priv"), "media/hot")
  end

  defp config do
    Application.get_env(:vostok_server, VostokServer.Storage, [])
  end
end
