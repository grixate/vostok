defmodule VostokServer.Federation.ProtobufEnvelope do
  @moduledoc """
  Protobuf envelope for federation delivery transport.
  """

  use Protobuf, syntax: :proto3

  field :source_domain, 1, type: :string
  field :delivery_id, 2, type: :string
  field :idempotency_key, 3, type: :string
  field :event_type, 4, type: :string
  field :payload_json, 5, type: :bytes
  field :signature, 6, type: :string
  field :sent_at, 7, type: :string
  field :protocol_version, 8, type: :uint32
end
