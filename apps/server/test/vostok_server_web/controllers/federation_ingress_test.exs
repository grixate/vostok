defmodule VostokServerWeb.FederationIngressTest do
  use VostokServerWeb.ConnCase, async: false

  alias VostokServer.Federation.EnvelopeCodec
  alias VostokServer.Federation.Peer
  alias VostokServer.Repo

  setup do
    previous_registration_mode = Application.get_env(:vostok_server, :registration_mode)
    previous_transport = Application.get_env(:vostok_server, :federation_transport)

    Application.put_env(:vostok_server, :registration_mode, "open")

    Application.put_env(:vostok_server, :federation_transport,
      source_domain: "chat.local.example",
      require_client_cert: false
    )

    on_exit(fn ->
      Application.put_env(:vostok_server, :registration_mode, previous_registration_mode)
      Application.put_env(:vostok_server, :federation_transport, previous_transport)
    end)

    :ok
  end

  test "ingest_delivery accepts inbound relay payloads", %{conn: conn} do
    peer =
      %Peer{}
      |> Peer.changeset(%{
        domain: "chat.remote.example",
        status: "active",
        display_name: "Remote"
      })
      |> Repo.insert!()

    peer_id = peer.id

    ingest_conn =
      post(conn, "/api/v1/federation/deliveries", %{
        source_domain: peer.domain,
        delivery_id: "remote-delivery-42",
        event_type: "message_relay",
        payload: %{
          envelope_id: "env-42",
          chat_id: "chat-42"
        }
      })

    assert %{
             "delivery" => %{
               "peer_id" => ^peer_id,
               "direction" => "inbound",
               "status" => "delivered",
               "remote_delivery_id" => "remote-delivery-42"
             }
           } = json_response(ingest_conn, 202)
  end

  test "ingest_delivery accepts protobuf federation envelopes", %{conn: conn} do
    peer =
      %Peer{}
      |> Peer.changeset(%{
        domain: "chat.protobuf.example",
        status: "active",
        display_name: "Remote Proto"
      })
      |> Repo.insert!()

    peer_id = peer.id

    payload =
      EnvelopeCodec.encode_protobuf(%{
        source_domain: peer.domain,
        delivery_id: "remote-protobuf-delivery-1",
        idempotency_key: "proto-idempotency-1",
        event_type: "message_relay",
        payload: %{
          envelope_id: "env-proto-1",
          chat_id: "chat-proto-1"
        },
        sent_at: DateTime.utc_now() |> DateTime.truncate(:millisecond) |> DateTime.to_iso8601(),
        protocol_version: 1
      })

    ingest_conn =
      conn
      |> put_req_header("content-type", EnvelopeCodec.protobuf_content_type())
      |> post("/api/v1/federation/deliveries", payload)

    assert %{
             "delivery" => %{
               "peer_id" => ^peer_id,
               "direction" => "inbound",
               "status" => "delivered",
               "remote_delivery_id" => "remote-protobuf-delivery-1"
             }
           } = json_response(ingest_conn, 202)
  end

  test "message_relay_v1 deliveries are ingested into local chat messages", %{conn: conn} do
    %{token: token, device_id: local_device_id} = register_device(conn, "federated-local")

    create_self_chat_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/direct", %{
        username: "federated-local"
      })

    assert %{"chat" => %{"id" => chat_id}} = json_response(create_self_chat_conn, 201)

    peer =
      %Peer{}
      |> Peer.changeset(%{
        domain: "chat.remote.example",
        status: "active",
        display_name: "Remote"
      })
      |> Repo.insert!()

    ingest_conn =
      post(conn, "/api/v1/federation/deliveries", %{
        source_domain: peer.domain,
        delivery_id: "remote-message-relay-1",
        event_type: "message_relay_v1",
        payload: %{
          chat_id: chat_id,
          client_id: "remote-client-1",
          message_kind: "text",
          ciphertext: Base.encode64("remote-ciphertext")
        }
      })

    assert %{"delivery" => %{"status" => "delivered"}} = json_response(ingest_conn, 202)

    messages_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/chats/#{chat_id}/messages")

    assert %{"messages" => messages} = json_response(messages_conn, 200)

    assert Enum.any?(messages, fn message ->
             message["client_id"] == "remote-client-1" &&
               message["ciphertext"] == Base.encode64("remote-ciphertext") &&
               message["sender_device_id"] != local_device_id
           end)
  end

  defp register_device(conn, username) do
    {identity_public_key_raw, identity_private_key_raw} = :crypto.generate_key(:eddsa, :ed25519)
    public_key = Base.encode64(identity_public_key_raw)
    encryption_public_key = Base.encode64(:crypto.strong_rand_bytes(65))
    signed_prekey_raw = :crypto.strong_rand_bytes(65)
    signed_prekey = Base.encode64(signed_prekey_raw)

    signed_prekey_signature =
      signed_prekey_raw
      |> then(&:crypto.sign(:eddsa, :none, &1, [identity_private_key_raw, :ed25519]))
      |> Base.encode64()

    register_conn =
      post(conn, "/api/v1/register", %{
        username: username,
        device_name: "Browser",
        device_identity_public_key: public_key,
        device_encryption_public_key: encryption_public_key,
        signed_prekey: signed_prekey,
        signed_prekey_signature: signed_prekey_signature,
        one_time_prekeys: [Base.encode64(:crypto.strong_rand_bytes(65))]
      })

    assert %{
             "session" => %{"token" => token},
             "device" => %{"id" => device_id}
           } = json_response(register_conn, 201)

    %{token: token, device_id: device_id}
  end
end
