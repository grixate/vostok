defmodule VostokServer.Federation.EnvelopeCodec do
  @moduledoc """
  Encoder/decoder for federation delivery envelopes.
  """

  alias VostokServer.Federation.ProtobufEnvelope

  @protobuf_content_type "application/x-protobuf"
  @default_protocol_version 1

  def protobuf_content_type, do: @protobuf_content_type

  def encode_protobuf(attrs) when is_map(attrs) do
    payload = normalize_map(Map.get(attrs, "payload") || Map.get(attrs, :payload))

    payload_json =
      payload
      |> canonicalize_map()
      |> Jason.encode!()

    envelope = %ProtobufEnvelope{
      source_domain:
        normalize_string(Map.get(attrs, "source_domain") || Map.get(attrs, :source_domain)) || "",
      delivery_id:
        normalize_string(Map.get(attrs, "delivery_id") || Map.get(attrs, :delivery_id)) || "",
      idempotency_key:
        normalize_string(Map.get(attrs, "idempotency_key") || Map.get(attrs, :idempotency_key)) ||
          "",
      event_type:
        normalize_string(Map.get(attrs, "event_type") || Map.get(attrs, :event_type)) || "",
      payload_json: payload_json,
      signature:
        normalize_string(Map.get(attrs, "signature") || Map.get(attrs, :signature)) || "",
      sent_at: normalize_string(Map.get(attrs, "sent_at") || Map.get(attrs, :sent_at)) || "",
      protocol_version:
        Map.get(attrs, "protocol_version") || Map.get(attrs, :protocol_version) ||
          @default_protocol_version
    }

    Protobuf.encode(envelope)
  end

  def decode_protobuf(binary) when is_binary(binary) do
    with {:ok, envelope} <- safe_decode(binary),
         {:ok, payload} <- decode_payload_json(envelope.payload_json) do
      {:ok,
       %{
         "source_domain" => envelope.source_domain,
         "delivery_id" => envelope.delivery_id,
         "idempotency_key" => envelope.idempotency_key,
         "event_type" => envelope.event_type,
         "payload" => payload,
         "signature" => normalize_string(envelope.signature),
         "sent_at" => normalize_string(envelope.sent_at),
         "protocol_version" => envelope.protocol_version
       }}
    end
  end

  defp safe_decode(binary) do
    {:ok, Protobuf.decode(binary, ProtobufEnvelope)}
  rescue
    _error -> {:error, {:validation, "Invalid protobuf federation envelope."}}
  end

  defp decode_payload_json(payload_json) when is_binary(payload_json) do
    case Jason.decode(payload_json) do
      {:ok, decoded} when is_map(decoded) ->
        {:ok, decoded}

      {:ok, _other} ->
        {:error, {:validation, "Federation payload_json must decode to an object."}}

      {:error, _reason} ->
        {:error, {:validation, "Federation payload_json is not valid JSON."}}
    end
  end

  defp normalize_map(%{} = map), do: map
  defp normalize_map(_), do: %{}

  defp normalize_string(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_string(_), do: nil

  defp canonicalize_map(map) when is_map(map) do
    map
    |> Enum.map(fn {key, value} ->
      normalized_value =
        cond do
          is_map(value) -> canonicalize_map(value)
          is_list(value) -> Enum.map(value, &canonicalize_value/1)
          true -> canonicalize_value(value)
        end

      {to_string(key), normalized_value}
    end)
    |> Enum.sort_by(&elem(&1, 0))
    |> Map.new()
  end

  defp canonicalize_value(value) when is_map(value), do: canonicalize_map(value)
  defp canonicalize_value(value) when is_list(value), do: Enum.map(value, &canonicalize_value/1)
  defp canonicalize_value(value), do: value
end
