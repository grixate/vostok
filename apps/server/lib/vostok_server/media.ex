defmodule VostokServer.Media do
  @moduledoc """
  Stage 4 media context for encrypted attachment upload and link metadata fetches.
  """

  import Bitwise
  import Ecto.Query

  alias VostokServer.Media.{Upload, UploadPart}
  alias VostokServer.Repo

  @max_link_title_length 140
  @max_link_description_length 320

  def create_upload(current_device_id, attrs)
      when is_binary(current_device_id) and is_map(attrs) do
    with {:ok, normalized} <- normalize_create_attrs(attrs) do
      %Upload{}
      |> Upload.changeset(Map.put(normalized, :uploader_device_id, current_device_id))
      |> Repo.insert()
      |> case do
        {:ok, upload} ->
          {:ok, present_upload(upload, uploaded_part_indexes: [])}

        {:error, changeset} ->
          {:error, {:validation, format_changeset_error(changeset)}}
      end
    end
  end

  def append_upload_part(upload_id, current_device_id, attrs)
      when is_binary(upload_id) and is_binary(current_device_id) and is_map(attrs) do
    with %Upload{} = upload <- Repo.get(Upload, upload_id),
         :ok <- authorize_upload_access(upload, current_device_id, true),
         {:ok, part_attrs} <- normalize_part_attrs(attrs),
         {:ok, updated} <- append_chunk(upload, part_attrs) do
      {:ok, present_upload(updated)}
    else
      nil ->
        {:error, {:not_found, "Upload not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def complete_upload(upload_id, current_device_id, attrs \\ %{})

  def complete_upload(upload_id, current_device_id, attrs)
      when is_binary(upload_id) and is_binary(current_device_id) and is_map(attrs) do
    with %Upload{} = upload <- Repo.get(Upload, upload_id),
         :ok <- authorize_upload_access(upload, current_device_id, true),
         {:ok, expected_ciphertext_sha256} <-
           normalize_optional_sha256(attrs["ciphertext_sha256"], "ciphertext_sha256"),
         {:ok, assembled_ciphertext, assembled_part_indexes} <- assemble_upload_ciphertext(upload),
         actual_ciphertext_sha256 = sha256_hex(assembled_ciphertext),
         :ok <-
           verify_ciphertext_digest(
             expected_ciphertext_sha256,
             actual_ciphertext_sha256
           ),
         {:ok, updated} <-
           upload
           |> Upload.changeset(%{
             status: "completed",
             completed_at: DateTime.utc_now(),
             ciphertext: assembled_ciphertext,
             ciphertext_sha256: actual_ciphertext_sha256,
             uploaded_byte_size: byte_size(assembled_ciphertext),
             expected_part_count: upload.expected_part_count || length(assembled_part_indexes)
           })
           |> Repo.update() do
      {:ok, present_upload(updated, uploaded_part_indexes: assembled_part_indexes)}
    else
      nil ->
        {:error, {:not_found, "Upload not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def fetch_upload(upload_id) when is_binary(upload_id) do
    case Repo.get(Upload, upload_id) do
      %Upload{} = upload ->
        {:ok, present_upload(upload, include_ciphertext: true)}

      nil ->
        {:error, {:not_found, "Upload not found."}}
    end
  end

  def fetch_upload_state(upload_id, current_device_id)
      when is_binary(upload_id) and is_binary(current_device_id) do
    with %Upload{} = upload <- Repo.get(Upload, upload_id),
         :ok <- authorize_upload_access(upload, current_device_id, true) do
      {:ok, present_upload(upload)}
    else
      nil ->
        {:error, {:not_found, "Upload not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def fetch_link_metadata(attrs) when is_map(attrs) do
    with {:ok, url} <- normalize_link_url(attrs),
         {:ok, uri} <- validate_link_uri(url),
         :ok <- validate_public_link_target(uri),
         {:ok, response} <- request_link_metadata(uri),
         {:ok, metadata} <- normalize_link_metadata(uri, response) do
      {:ok, metadata}
    else
      {:error, reason} -> {:error, reason}
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

    expected_part_count =
      attrs
      |> Map.get("expected_part_count")
      |> normalize_positive_integer_optional()

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
           expected_part_count: expected_part_count,
           uploaded_byte_size: 0,
           ciphertext: ""
         }}
    end
  end

  defp normalize_part_attrs(attrs) do
    with {:ok, chunk} <- fetch_chunk(attrs),
         {:ok, part_index} <- normalize_part_index_optional(Map.get(attrs, "part_index")),
         {:ok, part_count} <- normalize_part_count_optional(Map.get(attrs, "part_count")) do
      {:ok,
       %{
         chunk: chunk,
         part_index: part_index,
         part_count: part_count
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

  defp normalize_part_index_optional(nil), do: {:ok, nil}

  defp normalize_part_index_optional(value) do
    case normalize_non_negative_integer(value) do
      nil -> {:error, {:validation, "part_index must be a non-negative integer when provided."}}
      part_index -> {:ok, part_index}
    end
  end

  defp normalize_part_count_optional(nil), do: {:ok, nil}

  defp normalize_part_count_optional(value) do
    case normalize_positive_integer_optional(value) do
      nil -> {:error, {:validation, "part_count must be a positive integer when provided."}}
      part_count -> {:ok, part_count}
    end
  end

  defp append_chunk(%Upload{status: "completed"}, _part_attrs) do
    {:error, {:validation, "This upload has already been completed."}}
  end

  defp append_chunk(%Upload{} = upload, %{
         chunk: chunk,
         part_index: part_index,
         part_count: part_count
       }) do
    with {:ok, expected_part_count} <- resolve_expected_part_count(upload, part_count),
         {:ok, resolved_part_index} <- resolve_part_index(upload, part_index, expected_part_count),
         {:ok, _part} <- upsert_upload_part(upload, chunk, resolved_part_index),
         {:ok, updated_upload} <- update_upload_progress(upload, expected_part_count) do
      {:ok, updated_upload}
    end
  end

  defp resolve_expected_part_count(%Upload{expected_part_count: current}, nil), do: {:ok, current}

  defp resolve_expected_part_count(%Upload{expected_part_count: nil}, incoming)
       when is_integer(incoming) do
    {:ok, incoming}
  end

  defp resolve_expected_part_count(%Upload{expected_part_count: current}, incoming)
       when is_integer(current) and is_integer(incoming) do
    if current == incoming do
      {:ok, current}
    else
      {:error, {:validation, "part_count does not match the upload's expected part count."}}
    end
  end

  defp resolve_part_index(%Upload{} = upload, nil, expected_part_count) do
    next_index = next_upload_part_index(upload.id)

    if is_integer(expected_part_count) and next_index >= expected_part_count do
      {:error, {:validation, "All expected upload parts have already been received."}}
    else
      {:ok, next_index}
    end
  end

  defp resolve_part_index(%Upload{}, part_index, expected_part_count)
       when is_integer(part_index) do
    if is_integer(expected_part_count) and part_index >= expected_part_count do
      {:error, {:validation, "part_index exceeds the upload's expected part count."}}
    else
      {:ok, part_index}
    end
  end

  defp upsert_upload_part(%Upload{} = upload, chunk, part_index) do
    checksum = sha256_hex(chunk)
    byte_size = byte_size(chunk)

    case Repo.get_by(UploadPart, upload_id: upload.id, part_index: part_index) do
      %UploadPart{} = existing ->
        if existing.sha256 == checksum and existing.byte_size == byte_size do
          {:ok, existing}
        else
          {:error,
           {:validation,
            "part_index #{part_index} already exists with different ciphertext content."}}
        end

      nil ->
        %UploadPart{}
        |> UploadPart.changeset(%{
          upload_id: upload.id,
          part_index: part_index,
          chunk_ciphertext: chunk,
          byte_size: byte_size,
          sha256: checksum
        })
        |> Repo.insert()
        |> case do
          {:ok, upload_part} -> {:ok, upload_part}
          {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
        end
    end
  end

  defp update_upload_progress(%Upload{} = upload, expected_part_count) do
    uploaded_byte_size = upload_part_bytes(upload.id)

    upload
    |> Upload.changeset(%{
      uploaded_byte_size: uploaded_byte_size,
      expected_part_count: expected_part_count
    })
    |> Repo.update()
    |> case do
      {:ok, updated_upload} -> {:ok, updated_upload}
      {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
    end
  end

  defp assemble_upload_ciphertext(%Upload{} = upload) do
    parts = list_upload_parts(upload.id)

    if parts == [] do
      {:ok, upload.ciphertext || "", []}
    else
      case validate_upload_parts(parts, upload.expected_part_count) do
        :ok ->
          ciphertext = parts |> Enum.map(& &1.chunk_ciphertext) |> IO.iodata_to_binary()
          {:ok, ciphertext, Enum.map(parts, & &1.part_index)}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp validate_upload_parts(parts, expected_part_count) do
    indexes = Enum.map(parts, & &1.part_index)
    expected_indexes = Enum.to_list(0..(length(parts) - 1))

    cond do
      indexes != expected_indexes ->
        {:error,
         {:validation,
          "Upload is missing one or more chunks. Received part indexes: #{Enum.join(indexes, ",")}."}}

      is_integer(expected_part_count) and expected_part_count != length(parts) ->
        {:error,
         {:validation,
          "Upload expected #{expected_part_count} parts but received #{length(parts)}."}}

      true ->
        :ok
    end
  end

  defp normalize_link_url(attrs) do
    case attrs |> Map.get("url") |> normalize_string() do
      nil -> {:error, {:validation, "url is required."}}
      url -> {:ok, url}
    end
  end

  defp validate_link_uri(url) do
    uri = URI.parse(url)

    cond do
      uri.scheme not in ["https", "http"] ->
        {:error, {:validation, "url must use http or https."}}

      is_nil(uri.host) ->
        {:error, {:validation, "url host is required."}}

      true ->
        {:ok, uri}
    end
  end

  defp validate_public_link_target(%URI{host: host}) do
    normalized_host = String.downcase(host)

    cond do
      normalized_host in ["localhost", "localhost."] ->
        {:error, {:validation, "Localhost metadata fetches are blocked."}}

      String.ends_with?(normalized_host, ".local") ->
        {:error, {:validation, "Local network metadata fetches are blocked."}}

      true ->
        with {:ok, addresses} <- resolve_host_addresses(normalized_host),
             :ok <- ensure_public_addresses(addresses) do
          :ok
        end
    end
  end

  defp resolve_host_addresses(host) when is_binary(host) do
    case :inet.parse_address(String.to_charlist(host)) do
      {:ok, address} ->
        {:ok, [address]}

      {:error, :einval} ->
        ipv4_addresses =
          case :inet.getaddrs(String.to_charlist(host), :inet) do
            {:ok, addresses} -> addresses
            {:error, _reason} -> []
          end

        ipv6_addresses =
          case :inet.getaddrs(String.to_charlist(host), :inet6) do
            {:ok, addresses} -> addresses
            {:error, _reason} -> []
          end

        addresses = ipv4_addresses ++ ipv6_addresses

        if addresses == [] do
          {:error, {:validation, "Could not resolve metadata host address."}}
        else
          {:ok, addresses}
        end
    end
  end

  defp ensure_public_addresses(addresses) do
    if Enum.any?(addresses, &private_or_local_address?/1) do
      {:error, {:validation, "Metadata fetch is blocked for private or local network targets."}}
    else
      :ok
    end
  end

  defp private_or_local_address?({a, b, c, d}) do
    a == 10 or
      (a == 172 and b in 16..31) or
      (a == 192 and b == 168) or
      a == 127 or
      (a == 169 and b == 254) or
      (a == 100 and b in 64..127) or
      (a == 0 and b == 0 and c == 0 and d == 0)
  end

  defp private_or_local_address?({_, _, _, _, _, _, _, _} = ipv6) do
    ipv6 == {0, 0, 0, 0, 0, 0, 0, 0} or
      ipv6 == {0, 0, 0, 0, 0, 0, 0, 1} or
      link_local_ipv6?(ipv6) or
      unique_local_ipv6?(ipv6)
  end

  defp private_or_local_address?(_address), do: true

  defp unique_local_ipv6?({first_segment, _, _, _, _, _, _, _}) do
    (first_segment &&& 0xFE00) == 0xFC00
  end

  defp link_local_ipv6?({first_segment, _, _, _, _, _, _, _}) do
    (first_segment &&& 0xFFC0) == 0xFE80
  end

  defp request_link_metadata(%URI{} = uri) do
    request_url = URI.to_string(uri)

    request_options = [
      method: :get,
      url: request_url,
      retry: false,
      max_redirects: 0,
      receive_timeout: 5_000,
      connect_options: [timeout: 3_000],
      headers: [
        {"accept", "text/html,application/xhtml+xml"},
        {"user-agent", "VostokLinkMetadataBot/1.0"}
      ]
    ]

    case Req.request(request_options) do
      {:ok, %Req.Response{status: status} = response} when status in 200..299 ->
        {:ok, response}

      {:ok, %Req.Response{status: status}} ->
        {:error, {:validation, "Metadata fetch failed with status #{status}."}}

      {:error, exception} ->
        {:error, {:validation, "Metadata fetch failed: #{Exception.message(exception)}"}}
    end
  end

  defp normalize_link_metadata(%URI{} = uri, %Req.Response{} = response) do
    content_type = response.headers |> header_value("content-type") |> String.downcase()

    if String.contains?(content_type, "text/html") do
      body =
        case response.body do
          body when is_binary(body) -> body
          _ -> ""
        end

      {:ok,
       %{
         url: URI.to_string(uri),
         hostname: uri.host,
         title: extract_title(body) || uri.host,
         description: extract_description(body),
         site_name: extract_site_name(body),
         canonical_url: extract_canonical_url(body, uri),
         fetched_at: DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()
       }}
    else
      {:ok,
       %{
         url: URI.to_string(uri),
         hostname: uri.host,
         title: uri.host,
         description: nil,
         site_name: nil,
         canonical_url: URI.to_string(uri),
         fetched_at: DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()
       }}
    end
  end

  defp extract_title(body) when is_binary(body) do
    case Regex.run(~r/<title[^>]*>(.*?)<\/title>/isu, body, capture: :all_but_first) do
      [title] -> clean_snippet(title, @max_link_title_length)
      _ -> extract_meta_tag(body, "property", "og:title", @max_link_title_length)
    end
  end

  defp extract_description(body) when is_binary(body) do
    extract_meta_tag(body, "name", "description", @max_link_description_length) ||
      extract_meta_tag(body, "property", "og:description", @max_link_description_length)
  end

  defp extract_site_name(body) when is_binary(body) do
    extract_meta_tag(body, "property", "og:site_name", 120)
  end

  defp extract_meta_tag(body, attr_name, attr_value, max_length)
       when is_binary(body) and is_binary(attr_name) and is_binary(attr_value) do
    regex =
      ~r/<meta[^>]*#{attr_name}\s*=\s*["']#{Regex.escape(attr_value)}["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/isu

    case Regex.run(regex, body, capture: :all_but_first) do
      [value] -> clean_snippet(value, max_length)
      _ -> nil
    end
  end

  defp extract_canonical_url(body, base_uri) when is_binary(body) and is_map(base_uri) do
    case Regex.run(
           ~r/<link[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/isu,
           body,
           capture: :all_but_first
         ) do
      [href] ->
        href = String.trim(href)

        case URI.parse(href) do
          %URI{host: nil} = relative ->
            URI.merge(base_uri, relative) |> URI.to_string()

          %URI{scheme: nil, host: host} when is_binary(host) ->
            URI.merge(base_uri, URI.parse("https:" <> href)) |> URI.to_string()

          _ ->
            href
        end

      _ ->
        URI.to_string(base_uri)
    end
  end

  defp header_value(headers, key) when is_list(headers) and is_binary(key) do
    headers
    |> Enum.find_value("", fn {header_name, header_value} ->
      if String.downcase(header_name) == String.downcase(key) do
        header_value
      else
        nil
      end
    end)
  end

  defp clean_snippet(value, max_length) when is_binary(value) and is_integer(max_length) do
    value
    |> String.replace(~r/<[^>]*>/u, "")
    |> String.replace(~r/\s+/u, " ")
    |> String.trim()
    |> case do
      "" -> nil
      text -> String.slice(text, 0, max_length)
    end
  end

  defp authorize_upload_access(%Upload{uploader_device_id: device_id}, current_device_id, true)
       when device_id == current_device_id,
       do: :ok

  defp authorize_upload_access(%Upload{}, _current_device_id, true) do
    {:error, {:unauthorized, "Only the uploading device can mutate this media upload."}}
  end

  defp present_upload(%Upload{} = upload, opts \\ []) do
    uploaded_part_indexes =
      Keyword.get_lazy(opts, :uploaded_part_indexes, fn ->
        list_upload_part_indexes(upload.id)
      end)

    %{
      id: upload.id,
      status: upload.status,
      media_kind: upload.media_kind,
      filename: upload.filename,
      content_type: upload.content_type,
      declared_byte_size: upload.declared_byte_size,
      uploaded_byte_size: upload.uploaded_byte_size,
      expected_part_count: upload.expected_part_count,
      uploaded_part_count: length(uploaded_part_indexes),
      uploaded_part_indexes: uploaded_part_indexes,
      ciphertext_sha256: upload.ciphertext_sha256,
      completed_at: iso_or_nil(upload.completed_at),
      ciphertext:
        if Keyword.get(opts, :include_ciphertext, false) do
          Base.encode64(upload.ciphertext || "")
        else
          nil
        end
    }
  end

  defp list_upload_parts(upload_id) when is_binary(upload_id) do
    from(part in UploadPart,
      where: part.upload_id == ^upload_id,
      order_by: [asc: part.part_index]
    )
    |> Repo.all()
  end

  defp list_upload_part_indexes(upload_id) when is_binary(upload_id) do
    from(part in UploadPart,
      where: part.upload_id == ^upload_id,
      order_by: [asc: part.part_index],
      select: part.part_index
    )
    |> Repo.all()
  end

  defp upload_part_bytes(upload_id) when is_binary(upload_id) do
    from(part in UploadPart,
      where: part.upload_id == ^upload_id,
      select: coalesce(sum(part.byte_size), 0)
    )
    |> Repo.one()
    |> Kernel.||(0)
  end

  defp next_upload_part_index(upload_id) when is_binary(upload_id) do
    from(part in UploadPart,
      where: part.upload_id == ^upload_id,
      select: max(part.part_index)
    )
    |> Repo.one()
    |> case do
      nil -> 0
      part_index -> part_index + 1
    end
  end

  defp normalize_string(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_string(_), do: nil

  defp normalize_non_negative_integer(value) when is_integer(value) and value >= 0, do: value

  defp normalize_non_negative_integer(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {parsed, ""} when parsed >= 0 -> parsed
      _ -> nil
    end
  end

  defp normalize_non_negative_integer(_), do: nil

  defp normalize_positive_integer_optional(value) when is_integer(value) and value > 0, do: value

  defp normalize_positive_integer_optional(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {parsed, ""} when parsed > 0 -> parsed
      _ -> nil
    end
  end

  defp normalize_positive_integer_optional(_), do: nil

  defp normalize_optional_sha256(nil, _field), do: {:ok, nil}

  defp normalize_optional_sha256(value, field) when is_binary(field) do
    normalized =
      value
      |> normalize_string()
      |> case do
        nil -> nil
        candidate -> String.downcase(candidate)
      end

    cond do
      is_nil(normalized) ->
        {:ok, nil}

      String.match?(normalized, ~r/\A[0-9a-f]{64}\z/u) ->
        {:ok, normalized}

      true ->
        {:error, {:validation, "#{field} must be a lowercase 64-character SHA-256 hex digest."}}
    end
  end

  defp verify_ciphertext_digest(nil, _actual), do: :ok
  defp verify_ciphertext_digest(expected, expected), do: :ok

  defp verify_ciphertext_digest(expected, actual) do
    {:error,
     {:validation,
      "ciphertext_sha256 does not match the assembled ciphertext digest (expected #{expected}, got #{actual})."}}
  end

  defp sha256_hex(binary) when is_binary(binary) do
    :crypto.hash(:sha256, binary)
    |> Base.encode16(case: :lower)
  end

  defp format_changeset_error(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
    |> Enum.map(fn {field, [message | _]} -> "#{field} #{message}" end)
    |> List.first()
    |> Kernel.||("The media upload could not be saved.")
  end

  defp iso_or_nil(nil), do: nil
  defp iso_or_nil(%DateTime{} = value), do: DateTime.to_iso8601(value)
end
