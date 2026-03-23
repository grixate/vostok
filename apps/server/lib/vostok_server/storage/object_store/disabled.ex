defmodule VostokServer.Storage.ObjectStore.Disabled do
  @moduledoc "No-op adapter when object storage is not configured."

  @behaviour VostokServer.Storage.ObjectStore

  @impl true
  def put(_key, _blob, _content_type), do: {:error, :object_storage_disabled}

  @impl true
  def get(_key), do: {:error, :object_storage_disabled}

  @impl true
  def delete(_key), do: {:error, :object_storage_disabled}

  @impl true
  def presigned_url(_key, _expires_in), do: {:error, :object_storage_disabled}

  @impl true
  def head(_key), do: {:error, :object_storage_disabled}
end
