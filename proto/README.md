# Protocol Notes

This directory stores versioned protobuf definitions used by Vostok federation.

Implemented:

- `federation_delivery.proto`
  - `vostok.federation.v1.DeliveryEnvelope`
  - transport envelope used on `POST /api/v1/federation/deliveries`
  - payload body is canonical JSON stored in `payload_json`

Planned next contracts:

- peer handshake
- capability negotiation
- remote prekey fetch
- encrypted payload relay
- receipt relay
- presence relay
