defmodule VostokServer.Federation.Transport.MTLS do
  @moduledoc """
  Req-based mTLS federation transport for outbound delivery jobs.
  """

  @behaviour VostokServer.Federation.Transport

  alias VostokServer.Federation.DeliveryJob
  alias VostokServer.Federation.Peer

  @default_connect_timeout_ms 5_000
  @default_request_timeout_ms 10_000
  @default_delivery_path "/api/v1/federation/deliveries"

  @impl VostokServer.Federation.Transport
  def deliver(%Peer{} = peer, %DeliveryJob{} = job, options \\ []) do
    with {:ok, endpoint_url} <- delivery_endpoint(peer, options),
         {:ok, source_domain} <- source_domain(options),
         {:ok, connect_options} <- connect_options(endpoint_url, options),
         {:ok, response} <- do_post(endpoint_url, source_domain, job, connect_options, options) do
      classify_response(response)
    end
  end

  defp do_post(endpoint_url, source_domain, %DeliveryJob{} = job, connect_options, options) do
    request_options = [
      method: :post,
      url: endpoint_url,
      json: %{
        delivery_id: job.id,
        event_type: job.event_type,
        payload: job.payload,
        source_domain: source_domain,
        sent_at: DateTime.utc_now() |> DateTime.truncate(:millisecond) |> DateTime.to_iso8601()
      },
      headers: [{"x-vostok-source-domain", source_domain}],
      retry: false,
      receive_timeout: config_value(options, :request_timeout_ms, @default_request_timeout_ms),
      connect_options: connect_options
    ]

    case Req.request(request_options) do
      {:ok, %Req.Response{} = response} ->
        {:ok, response}

      {:error, exception} ->
        {:error, classify_exception(exception)}
    end
  end

  defp delivery_endpoint(%Peer{} = peer, options) do
    host = peer.domain |> normalize_string()

    if is_nil(host) do
      {:error, {:permanent, "Federation peer domain is missing."}}
    else
      default_port = Application.get_env(:vostok_server, :federation_port, 5555)
      path = config_value(options, :delivery_path, @default_delivery_path)

      scheme =
        options
        |> config_value(:scheme, "https")
        |> normalize_string()
        |> Kernel.||("https")

      uri = %URI{scheme: scheme, host: host, port: default_port, path: path}
      {:ok, URI.to_string(uri)}
    end
  end

  defp source_domain(options) do
    configured_domain =
      options
      |> config_value(:source_domain, Application.get_env(:vostok_server, :federation_domain))
      |> normalize_string()

    case configured_domain do
      nil -> {:error, {:permanent, "federation source domain is not configured."}}
      domain -> {:ok, domain}
    end
  end

  defp connect_options(endpoint_url, options) do
    uri = URI.parse(endpoint_url)
    connect_timeout = config_value(options, :connect_timeout_ms, @default_connect_timeout_ms)

    case uri.scheme do
      "http" ->
        if truthy?(Keyword.get(options, :allow_insecure_http)) do
          {:ok, [timeout: connect_timeout]}
        else
          {:error, {:permanent, "Insecure federation transport is disabled for this peer."}}
        end

      "https" ->
        build_mtls_connect_options(uri, connect_timeout, options)

      _ ->
        {:error, {:permanent, "Unsupported federation transport scheme."}}
    end
  end

  defp build_mtls_connect_options(uri, connect_timeout, options) do
    mtls_options =
      options
      |> Keyword.get(:mtls, [])
      |> normalize_keyword_list()

    certfile = mtls_options |> Keyword.get(:certfile) |> normalize_string()
    keyfile = mtls_options |> Keyword.get(:keyfile) |> normalize_string()
    cacertfile = mtls_options |> Keyword.get(:cacertfile) |> normalize_string()

    with :ok <- ensure_path_exists(certfile, "mtls.certfile"),
         :ok <- ensure_path_exists(keyfile, "mtls.keyfile"),
         :ok <- ensure_path_exists(cacertfile, "mtls.cacertfile"),
         {:ok, sni_host} <- server_name_indication(uri, mtls_options) do
      transport_opts = [
        verify: :verify_peer,
        certfile: certfile,
        keyfile: keyfile,
        cacertfile: cacertfile,
        server_name_indication: sni_host,
        customize_hostname_check: [match_fun: :public_key.pkix_verify_hostname_match_fun(:https)]
      ]

      {:ok, [timeout: connect_timeout, transport_opts: transport_opts]}
    end
  end

  defp server_name_indication(%URI{} = uri, mtls_options) do
    configured_sni = mtls_options |> Keyword.get(:server_name_indication) |> normalize_string()
    candidate = configured_sni || uri.host

    case candidate do
      nil -> {:error, {:permanent, "Could not derive TLS server_name_indication value."}}
      host -> {:ok, String.to_charlist(host)}
    end
  end

  defp classify_response(%Req.Response{status: status} = response)
       when status in 200..299 do
    {:ok, %{remote_status: status, remote_body: response.body}}
  end

  defp classify_response(%Req.Response{status: 409} = response) do
    # Duplicate relay acknowledgements are safe and should not trigger retries.
    {:ok, %{remote_status: 409, remote_body: response.body}}
  end

  defp classify_response(%Req.Response{status: status, body: body})
       when status in [408, 425, 429] or status >= 500 do
    {:error, {:retryable, remote_error_message(status, body)}}
  end

  defp classify_response(%Req.Response{status: status, body: body}) do
    {:error, {:permanent, remote_error_message(status, body)}}
  end

  defp remote_error_message(status, body) do
    case extract_error_detail(body) do
      nil -> "Remote federation peer responded with status #{status}."
      detail -> "Remote federation peer responded with status #{status}: #{detail}"
    end
  end

  defp extract_error_detail(%{"message" => message}) when is_binary(message), do: message
  defp extract_error_detail(%{"error" => message}) when is_binary(message), do: message
  defp extract_error_detail(message) when is_binary(message), do: normalize_string(message)
  defp extract_error_detail(_), do: nil

  defp classify_exception(exception) do
    reason =
      cond do
        is_exception(exception) and function_exported?(exception.__struct__, :message, 1) ->
          Exception.message(exception)

        true ->
          inspect(exception)
      end

    {:retryable, reason}
  end

  defp ensure_path_exists(nil, field_name),
    do: {:error, {:permanent, "#{field_name} is not configured."}}

  defp ensure_path_exists(path, field_name) do
    if File.exists?(path) do
      :ok
    else
      {:error, {:permanent, "#{field_name} file does not exist: #{path}"}}
    end
  end

  defp config_value(options, key, default) do
    value = Keyword.get(options, key, default)
    if is_nil(value), do: default, else: value
  end

  defp normalize_keyword_list(options) when is_list(options), do: options
  defp normalize_keyword_list(%{} = options), do: Map.to_list(options)
  defp normalize_keyword_list(_), do: []

  defp normalize_string(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_string(_), do: nil

  defp truthy?(value) when value in [true, "true", "1", 1], do: true
  defp truthy?(_), do: false
end
