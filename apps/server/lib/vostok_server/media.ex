defmodule VostokServer.Media do
  @moduledoc """
  Stage 4 media upload context for opaque encrypted attachments.
  """

  alias VostokServer.Media.Upload
  alias VostokServer.Repo

  def create_upload(current_device_id, attrs)
      when is_binary(current_device_id) and is_map(attrs) do
    with {:ok, normalized} <- normalize_create_attrs(attrs) do
      %Upload{}
      |> Upload.changeset(Map.put(normalized, :uploader_device_id, current_device_id))
      |> Repo.insert()
      |> case do
        {:ok, upload} -> {:ok, present_upload(upload)}
        {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
      end
    end
  end

  def append_upload_part(upload_id, current_device_id, attrs)
      when is_binary(upload_id) and is_binary(current_device_id) and is_map(attrs) do
    with %Upload{} = upload <- Repo.get(Upload, upload_id),
         :ok <- authorize_upload_access(upload, current_device_id, true),
         {:ok, chunk} <- fetch_chunk(attrs),
         {:ok, updated} <- append_chunk(upload, chunk) do
      {:ok, present_upload(updated)}
    else
      nil ->
        {:error, {:not_found, "Upload not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def complete_upload(upload_id, current_device_id)
      when is_binary(upload_id) and is_binary(current_device_id) do
    with %Upload{} = upload <- Repo.get(Upload, upload_id),
         :ok <- authorize_upload_access(upload, current_device_id, true) do
      upload
      |> Upload.changeset(%{
        status: "completed",
        completed_at: DateTime.utc_now()
      })
      |> Repo.update()
      |> case do
        {:ok, updated} -> {:ok, present_upload(updated)}
        {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
      end
    else
      nil ->
        {:error, {:not_found, "Upload not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def fetch_upload(upload_id) when is_binary(upload_id) do
    case Repo.get(Upload, upload_id) do
      %Upload{} = upload -> {:ok, present_upload(upload, include_ciphertext: true)}
      nil -> {:error, {:not_found, "Upload not found."}}
    end
  end

  defp normalize_create_attrs(attrs) do
    filename = attrs |> Map.get("filename") |> normalize_string()

    content_type =
      attrs
      |> Map.get("content_type")
      |> normalize_string()
      |> Kernel.||("application/octet-stream")

    media_kind =
      attrs
      |> Map.get("media_kind")
      |> normalize_string()
      |> Kernel.||("file")

    declared_byte_size = normalize_non_negative_integer(Map.get(attrs, "declared_byte_size"))

    cond do
      is_nil(filename) ->
        {:error, {:validation, "filename is required."}}

      is_nil(declared_byte_size) ->
        {:error, {:validation, "declared_byte_size must be a non-negative integer."}}

      true ->
        {:ok,
         %{
           status: "pending",
           media_kind: media_kind,
           filename: filename,
           content_type: content_type,
           declared_byte_size: declared_byte_size,
           uploaded_byte_size: 0,
           ciphertext: ""
         }}
    end
  end

  defp fetch_chunk(attrs) do
    case attrs |> Map.get("chunk") |> normalize_string() do
      nil ->
        {:error, {:validation, "chunk is required."}}

      encoded ->
        case Base.decode64(encoded) do
          {:ok, decoded} -> {:ok, decoded}
          :error -> {:error, {:validation, "chunk must be valid base64."}}
        end
    end
  end

  defp append_chunk(%Upload{status: "completed"}, _chunk) do
    {:error, {:validation, "This upload has already been completed."}}
  end

  defp append_chunk(%Upload{} = upload, chunk) do
    updated_ciphertext = (upload.ciphertext || "") <> chunk
    updated_byte_size = byte_size(updated_ciphertext)

    upload
    |> Upload.changeset(%{
      ciphertext: updated_ciphertext,
      uploaded_byte_size: updated_byte_size
    })
    |> Repo.update()
    |> case do
      {:ok, updated} -> {:ok, updated}
      {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
    end
  end

  defp authorize_upload_access(%Upload{uploader_device_id: device_id}, current_device_id, true)
       when device_id == current_device_id,
       do: :ok

  defp authorize_upload_access(%Upload{}, _current_device_id, true) do
    {:error, {:unauthorized, "Only the uploading device can mutate this media upload."}}
  end

  defp present_upload(%Upload{} = upload, opts \\ []) do
    %{
      id: upload.id,
      status: upload.status,
      media_kind: upload.media_kind,
      filename: upload.filename,
      content_type: upload.content_type,
      declared_byte_size: upload.declared_byte_size,
      uploaded_byte_size: upload.uploaded_byte_size,
      completed_at: iso_or_nil(upload.completed_at),
      ciphertext:
        if Keyword.get(opts, :include_ciphertext, false) do
          Base.encode64(upload.ciphertext || "")
        else
          nil
        end
    }
  end

  defp normalize_string(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_string(_), do: nil

  defp normalize_non_negative_integer(value) when is_integer(value) and value >= 0, do: value
  defp normalize_non_negative_integer(_), do: nil

  defp format_changeset_error(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
    |> Enum.map(fn {field, [message | _]} -> "#{field} #{message}" end)
    |> List.first()
    |> Kernel.||("The media upload could not be saved.")
  end

  defp iso_or_nil(nil), do: nil
  defp iso_or_nil(%DateTime{} = value), do: DateTime.to_iso8601(value)
end
