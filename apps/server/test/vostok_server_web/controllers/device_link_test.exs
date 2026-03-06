defmodule VostokServerWeb.DeviceLinkTest do
  use VostokServerWeb.ConnCase, async: false

  setup do
    previous = Application.get_env(:vostok_server, :registration_mode)
    Application.put_env(:vostok_server, :registration_mode, "open")
    on_exit(fn -> Application.put_env(:vostok_server, :registration_mode, previous) end)
    :ok
  end

  test "linking a second device enables multi-device bootstrap and consumes one-time prekeys", %{
    conn: conn
  } do
    primary_material = build_device_material()

    register_conn =
      post(conn, "/api/v1/register", %{
        username: "alice",
        device_name: "Primary Browser",
        device_identity_public_key: primary_material.identity_public_key,
        device_encryption_public_key: primary_material.encryption_public_key,
        signed_prekey: primary_material.signed_prekey,
        signed_prekey_signature: primary_material.signed_prekey_signature,
        one_time_prekeys: [primary_material.one_time_prekey]
      })

    assert %{
             "device" => %{"id" => primary_device_id},
             "session" => %{"token" => primary_token}
           } = json_response(register_conn, 201)

    linked_material = build_device_material()

    link_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{primary_token}")
      |> post("/api/v1/devices/link", %{
        device_name: "Linked Laptop",
        device_identity_public_key: linked_material.identity_public_key,
        device_encryption_public_key: linked_material.encryption_public_key,
        signed_prekey: linked_material.signed_prekey,
        signed_prekey_signature: linked_material.signed_prekey_signature,
        one_time_prekeys: [linked_material.one_time_prekey]
      })

    assert %{
             "device" => %{"id" => linked_device_id, "device_name" => "Linked Laptop"},
             "prekey_count" => 1,
             "session" => %{"token" => linked_session_token},
             "user" => %{"username" => "alice"}
           } = json_response(link_conn, 201)

    assert is_binary(linked_session_token)
    refute linked_device_id == primary_device_id

    me_linked_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{linked_session_token}")
      |> get("/api/v1/me")

    assert %{
             "device" => %{"id" => ^linked_device_id},
             "user" => %{"username" => "alice"}
           } = json_response(me_linked_conn, 200)

    pre_bootstrap_prekeys_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{primary_token}")
      |> get("/api/v1/users/alice/devices/prekeys")

    assert %{"devices" => pre_bootstrap_bundles} = json_response(pre_bootstrap_prekeys_conn, 200)
    assert length(pre_bootstrap_bundles) == 2

    assert Enum.any?(pre_bootstrap_bundles, fn bundle ->
             bundle["device_id"] == linked_device_id and
               bundle["one_time_prekey"] == linked_material.one_time_prekey
           end)

    create_chat_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{primary_token}")
      |> post("/api/v1/chats/direct", %{username: "alice"})

    assert %{"chat" => %{"id" => chat_id}} = json_response(create_chat_conn, 201)

    bootstrap_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{primary_token}")
      |> post("/api/v1/chats/#{chat_id}/session-bootstrap", %{
        initiator_ephemeral_keys: %{
          primary_device_id => Base.encode64(:crypto.strong_rand_bytes(65)),
          linked_device_id => Base.encode64(:crypto.strong_rand_bytes(65))
        }
      })

    assert %{"sessions" => sessions} = json_response(bootstrap_conn, 200)

    assert Enum.any?(sessions, fn session ->
             session["initiator_device_id"] == primary_device_id and
               session["recipient_device_id"] == linked_device_id and
               session["recipient_one_time_prekey"] == linked_material.one_time_prekey and
               session["session_state"] == "active"
           end)

    ciphertext = Base.encode64("opaque-ciphertext")
    header = Base.encode64(~s({"algorithm":"test"}))
    primary_envelope = Base.encode64("primary-envelope")
    linked_envelope = Base.encode64("linked-envelope")

    missing_envelope_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{primary_token}")
      |> post("/api/v1/chats/#{chat_id}/messages", %{
        client_id: "missing-envelope",
        ciphertext: ciphertext,
        header: header,
        message_kind: "text",
        recipient_envelopes: %{
          primary_device_id => primary_envelope
        }
      })

    assert %{
             "error" => "validation",
             "message" => "recipient_envelopes must include every active recipient device."
           } = json_response(missing_envelope_conn, 422)

    complete_envelope_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{primary_token}")
      |> post("/api/v1/chats/#{chat_id}/messages", %{
        client_id: "complete-envelope",
        ciphertext: ciphertext,
        header: header,
        message_kind: "text",
        recipient_envelopes: %{
          primary_device_id => primary_envelope,
          linked_device_id => linked_envelope
        }
      })

    assert %{
             "message" => %{
               "message_kind" => "text",
               "recipient_device_ids" => recipient_device_ids,
               "recipient_envelope" => ^primary_envelope
             }
           } = json_response(complete_envelope_conn, 201)

    assert Enum.sort(recipient_device_ids) ==
             Enum.sort([primary_device_id, linked_device_id])

    post_bootstrap_prekeys_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{primary_token}")
      |> get("/api/v1/users/alice/devices/prekeys")

    assert %{"devices" => post_bootstrap_bundles} =
             json_response(post_bootstrap_prekeys_conn, 200)

    assert Enum.any?(post_bootstrap_bundles, fn bundle ->
             bundle["device_id"] == linked_device_id and is_nil(bundle["one_time_prekey"])
           end)
  end

  test "device push token registration persists provider metadata", %{conn: conn} do
    material = build_device_material()

    register_conn =
      post(conn, "/api/v1/register", %{
        username: "push-user",
        device_name: "Primary Browser",
        device_identity_public_key: material.identity_public_key,
        device_encryption_public_key: material.encryption_public_key,
        signed_prekey: material.signed_prekey,
        signed_prekey_signature: material.signed_prekey_signature,
        one_time_prekeys: [material.one_time_prekey]
      })

    assert %{
             "device" => %{"id" => device_id},
             "session" => %{"token" => token}
           } = json_response(register_conn, 201)

    push_token = "fcm-token-123"

    push_token_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/devices/push-token", %{
        push_provider: "fcm",
        push_token: push_token
      })

    assert %{
             "device" => %{
               "id" => ^device_id,
               "push_provider" => "fcm",
               "push_token_updated_at" => push_token_updated_at
             }
           } = json_response(push_token_conn, 200)

    assert is_binary(push_token_updated_at)

    devices_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/devices")

    assert %{"devices" => devices} = json_response(devices_conn, 200)

    assert Enum.any?(devices, fn device ->
             device["id"] == device_id and device["push_provider"] == "fcm" and
               device["push_token_updated_at"] == push_token_updated_at
           end)
  end

  defp build_device_material do
    {identity_public_key_raw, identity_private_key_raw} = :crypto.generate_key(:eddsa, :ed25519)
    signed_prekey_raw = :crypto.strong_rand_bytes(65)

    signed_prekey_signature_raw =
      :crypto.sign(:eddsa, :none, signed_prekey_raw, [identity_private_key_raw, :ed25519])

    %{
      identity_public_key: Base.encode64(identity_public_key_raw),
      encryption_public_key: Base.encode64(:crypto.strong_rand_bytes(65)),
      signed_prekey: Base.encode64(signed_prekey_raw),
      signed_prekey_signature: Base.encode64(signed_prekey_signature_raw),
      one_time_prekey: Base.encode64(:crypto.strong_rand_bytes(65))
    }
  end
end
