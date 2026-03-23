defmodule VostokServer.Storage.ObjectStore do
  @moduledoc """
  Behaviour for pluggable object storage backends (S3-compatible).
  """

  @type key :: String.t()

  @callback put(key, blob :: binary(), content_type :: String.t()) ::
              {:ok, %{key: key, size: integer()}} | {:error, term()}

  @callback get(key) ::
              {:ok, binary()} | {:error, :not_found | term()}

  @callback delete(key) ::
              :ok | {:error, term()}

  @callback presigned_url(key, expires_in :: integer()) ::
              {:ok, String.t()} | {:error, term()}

  @callback head(key) ::
              {:ok, %{size: integer(), content_type: String.t()}} | {:error, :not_found | term()}

  @doc "Get the configured object store adapter module."
  def adapter do
    config = Application.get_env(:vostok_server, VostokServer.Storage, [])
    object_config = Keyword.get(config, :object_store, [])

    if Keyword.get(object_config, :enabled, false) do
      Keyword.get(object_config, :adapter, VostokServer.Storage.ObjectStore.Disabled)
    else
      VostokServer.Storage.ObjectStore.Disabled
    end
  end

  @doc "Check if object storage is enabled."
  def enabled? do
    adapter() != VostokServer.Storage.ObjectStore.Disabled
  end

  @doc "Build an object key for a media item."
  def object_key(chat_id, media_id) do
    now = DateTime.utc_now()
    instance_id = instance_id()
    year = now.year
    month = now.month |> Integer.to_string() |> String.pad_leading(2, "0")
    "v/#{instance_id}/#{chat_id}/#{year}/#{month}/#{media_id}"
  end

  defp instance_id do
    Application.get_env(:vostok_server, :instance_id, "default")
  end
end
