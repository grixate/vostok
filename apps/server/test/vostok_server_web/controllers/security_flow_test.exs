defmodule VostokServerWeb.SecurityFlowTest do
  use VostokServerWeb.ConnCase, async: false

  setup do
    previous = Application.get_env(:vostok_server, :registration_mode)
    Application.put_env(:vostok_server, :registration_mode, "open")
    on_exit(fn -> Application.put_env(:vostok_server, :registration_mode, previous) end)
    :ok
  end

  test "device listing and revocation enforce ownership and self-protection", %{conn: conn} do
    %{device_id: primary_device_id, token: primary_token} =
      register_device(conn, "security-alice")

    linked_material = build_device_material()

    link_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{primary_token}")
      |> post("/api/v1/devices/link", %{
        device_name: "Linked Workstation",
        device_identity_public_key: linked_material.identity_public_key,
        device_encryption_public_key: linked_material.encryption_public_key,
        signed_prekey: linked_material.signed_prekey,
        signed_prekey_signature: linked_material.signed_prekey_signature,
        kyber_prekey: linked_material.kyber_prekey,
        kyber_prekey_signature: linked_material.kyber_prekey_signature,
        one_time_prekeys: [linked_material.one_time_prekey]
      })

    assert %{
             "device" => %{"id" => linked_device_id},
             "session" => %{"token" => linked_token}
           } = json_response(link_conn, 201)

    list_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{primary_token}")
      |> get("/api/v1/devices")

    assert %{"devices" => devices} = json_response(list_conn, 200)
    assert length(devices) == 2
    assert Enum.any?(devices, &(&1["id"] == primary_device_id and &1["is_current"] == true))
    assert Enum.any?(devices, &(&1["id"] == linked_device_id and &1["revoked_at"] == nil))

    me_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{primary_token}")
      |> get("/api/v1/me")

    assert %{
             "device" => %{
               "id" => ^primary_device_id,
               "prekeys" => %{
                 "device_id" => ^primary_device_id,
                 "available_one_time_prekeys" => available_one_time_prekeys,
                 "low_watermark" => low_watermark,
                 "target_count" => target_count,
                 "replenish_recommended" => replenish_recommended
               }
             }
           } = json_response(me_conn, 200)

    assert is_integer(available_one_time_prekeys)
    assert is_integer(low_watermark)
    assert is_integer(target_count)
    assert is_boolean(replenish_recommended)

    revoke_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{primary_token}")
      |> post("/api/v1/devices/#{linked_device_id}/revoke", %{})

    assert %{
             "device" => %{
               "id" => ^linked_device_id,
               "is_current" => false,
               "revoked_at" => revoked_at
             }
           } = json_response(revoke_conn, 200)

    assert is_binary(revoked_at)

    self_revoke_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{primary_token}")
      |> post("/api/v1/devices/#{primary_device_id}/revoke", %{})

    assert %{
             "error" => "validation",
             "message" => "The active device cannot revoke itself."
           } = json_response(self_revoke_conn, 422)

    revoked_me_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{linked_token}")
      |> get("/api/v1/me")

    assert %{
             "error" => "unauthorized"
           } = json_response(revoked_me_conn, 401)
  end

  test "safety-number listing and verification persist per chat/device", %{conn: conn} do
    %{device_id: alice_device_id, token: alice_token} = register_device(conn, "safety-alice")
    %{device_id: bob_device_id} = register_device(build_conn(), "safety-bob")

    create_chat_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/direct", %{username: "safety-bob"})

    assert %{
             "chat" => %{
               "id" => chat_id
             }
           } = json_response(create_chat_conn, 201)

    list_before_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> get("/api/v1/chats/#{chat_id}/safety-numbers")

    assert %{
             "safety_numbers" => [
               %{
                 "chat_id" => ^chat_id,
                 "peer_device_id" => ^bob_device_id,
                 "verified" => false,
                 "verified_at" => nil,
                 "fingerprint" => initial_fingerprint
               }
             ]
           } = json_response(list_before_conn, 200)

    assert is_binary(initial_fingerprint)
    assert String.length(initial_fingerprint) > 0

    verify_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/#{chat_id}/safety-numbers/#{bob_device_id}/verify", %{})

    assert %{
             "safety_number" => %{
               "chat_id" => ^chat_id,
               "peer_device_id" => ^bob_device_id,
               "verified" => true,
               "verified_at" => verified_at,
               "fingerprint" => ^initial_fingerprint
             }
           } = json_response(verify_conn, 200)

    assert is_binary(verified_at)

    list_after_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> get("/api/v1/chats/#{chat_id}/safety-numbers")

    assert %{
             "safety_numbers" => [
               %{
                 "peer_device_id" => ^bob_device_id,
                 "verified" => true,
                 "verified_at" => verified_at_after,
                 "fingerprint" => ^initial_fingerprint
               }
             ]
           } = json_response(list_after_conn, 200)

    assert is_binary(verified_at_after)
    refute alice_device_id == bob_device_id
  end

  test "key backup upload rejects mismatched hashes and persists verified backups", %{conn: conn} do
    %{token: token} = register_device(conn, "backup-alice")
    encrypted_blob = "encrypted-key-backup"

    mismatch_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> put("/api/v1/keys/backup", %{
        encrypted_blob: Base.encode64(encrypted_blob),
        blob_hash: sha256_hex("different-ciphertext"),
        version: 2
      })

    assert %{
             "error" => "blob_hash_mismatch"
           } = json_response(mismatch_conn, 422)

    upload_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> put("/api/v1/keys/backup", %{
        encrypted_blob: Base.encode64(encrypted_blob),
        blob_hash: sha256_hex(encrypted_blob),
        version: 2
      })

    assert %{
             "blob_hash" => blob_hash,
             "version" => 2
           } = json_response(upload_conn, 200)

    assert blob_hash == sha256_hex(encrypted_blob)

    download_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/keys/backup")

    assert %{
             "encrypted_blob" => encrypted_blob_b64,
             "blob_hash" => ^blob_hash,
             "version" => 2
           } = json_response(download_conn, 200)

    assert encrypted_blob_b64 == Base.encode64(encrypted_blob)
  end

  defp register_device(conn, username) do
    material = build_device_material()

    register_conn =
      post(conn, "/api/v1/register", %{
        username: username,
        device_name: "Browser",
        device_identity_public_key: material.identity_public_key,
        device_encryption_public_key: material.encryption_public_key,
        signed_prekey: material.signed_prekey,
        signed_prekey_signature: material.signed_prekey_signature,
        kyber_prekey: material.kyber_prekey,
        kyber_prekey_signature: material.kyber_prekey_signature,
        one_time_prekeys: [material.one_time_prekey]
      })

    assert %{
             "session" => %{"token" => token},
             "user" => %{"id" => user_id},
             "device" => %{"id" => device_id}
           } = json_response(register_conn, 201)

    %{token: token, user_id: user_id, device_id: device_id}
  end

  defp build_device_material do
    {identity_public_key_raw, identity_private_key_raw} = :crypto.generate_key(:eddsa, :ed25519)
    signed_prekey_raw = :crypto.strong_rand_bytes(65)

    signed_prekey_signature_raw =
      :crypto.sign(:eddsa, :none, signed_prekey_raw, [identity_private_key_raw, :ed25519])

    kyber_prekey_raw = :crypto.strong_rand_bytes(1568)

    kyber_prekey_signature_raw =
      :crypto.sign(:eddsa, :none, kyber_prekey_raw, [identity_private_key_raw, :ed25519])

    %{
      identity_public_key: Base.encode64(identity_public_key_raw),
      encryption_public_key: Base.encode64(:crypto.strong_rand_bytes(65)),
      signed_prekey: Base.encode64(signed_prekey_raw),
      signed_prekey_signature: Base.encode64(signed_prekey_signature_raw),
      kyber_prekey: Base.encode64(kyber_prekey_raw),
      kyber_prekey_signature: Base.encode64(kyber_prekey_signature_raw),
      one_time_prekey: Base.encode64(:crypto.strong_rand_bytes(65))
    }
  end

  defp sha256_hex(payload) when is_binary(payload) do
    :crypto.hash(:sha256, payload)
    |> Base.encode16(case: :lower)
  end
end
