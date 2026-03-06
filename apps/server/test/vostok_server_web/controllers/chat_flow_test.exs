defmodule VostokServerWeb.ChatFlowTest do
  use VostokServerWeb.ConnCase, async: false

  setup do
    previous = Application.get_env(:vostok_server, :registration_mode)
    Application.put_env(:vostok_server, :registration_mode, "open")
    on_exit(fn -> Application.put_env(:vostok_server, :registration_mode, previous) end)
    :ok
  end

  test "registration, self-chat creation, and message flow work together", %{conn: conn} do
    {identity_public_key_raw, identity_private_key_raw} = :crypto.generate_key(:eddsa, :ed25519)
    public_key = Base.encode64(identity_public_key_raw)
    encryption_public_key = Base.encode64(:crypto.strong_rand_bytes(65))
    signed_prekey_raw = :crypto.strong_rand_bytes(65)
    signed_prekey = Base.encode64(signed_prekey_raw)

    signed_prekey_signature =
      signed_prekey_raw
      |> then(&:crypto.sign(:eddsa, :none, &1, [identity_private_key_raw, :ed25519]))
      |> Base.encode64()

    one_time_prekey = Base.encode64(:crypto.strong_rand_bytes(65))

    conn =
      post(conn, "/api/v1/register", %{
        username: "alice",
        device_name: "Browser",
        device_identity_public_key: public_key,
        device_encryption_public_key: encryption_public_key,
        signed_prekey: signed_prekey,
        signed_prekey_signature: signed_prekey_signature,
        one_time_prekeys: [one_time_prekey]
      })

    assert %{
             "device" => %{"id" => device_id},
             "prekey_count" => 1,
             "session" => %{"token" => token},
             "user" => %{"username" => "alice"}
           } = json_response(conn, 201)

    profile_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/me")

    assert %{
             "device" => %{"id" => ^device_id},
             "user" => %{"username" => "alice"}
           } = json_response(profile_conn, 200)

    create_chat_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/direct", %{username: "alice"})

    assert %{
             "chat" => %{
               "id" => chat_id,
               "is_self_chat" => true,
               "title" => "Saved Messages"
             }
           } = json_response(create_chat_conn, 201)

    initiator_ephemeral_public_key = Base.encode64(:crypto.strong_rand_bytes(65))

    bootstrap_session_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/#{chat_id}/session-bootstrap", %{
        initiator_ephemeral_keys: %{
          device_id => initiator_ephemeral_public_key
        }
      })

    assert %{
             "sessions" => [
               %{
                 "established_at" => nil,
                 "establishment_state" => "pending_first_message",
                 "chat_id" => ^chat_id,
                 "handshake_hash" => handshake_hash,
                 "initiator_device_id" => ^device_id,
                 "id" => session_id,
                 "initiator_ephemeral_public_key" => ^initiator_ephemeral_public_key,
                 "recipient_device_id" => ^device_id,
                 "recipient_one_time_prekey" => nil,
                 "status" => "active"
               }
             ]
           } = json_response(bootstrap_session_conn, 200)

    assert is_binary(handshake_hash)
    refute handshake_hash == ""

    rotated_initiator_ephemeral_public_key = Base.encode64(:crypto.strong_rand_bytes(65))

    refreshed_bootstrap_session_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/#{chat_id}/session-bootstrap", %{
        initiator_ephemeral_keys: %{
          device_id => rotated_initiator_ephemeral_public_key
        }
      })

    assert %{
             "sessions" => [
               %{
                 "established_at" => nil,
                 "establishment_state" => "pending_first_message",
                 "chat_id" => ^chat_id,
                 "handshake_hash" => refreshed_handshake_hash,
                 "initiator_device_id" => ^device_id,
                 "id" => ^session_id,
                 "initiator_ephemeral_public_key" => ^rotated_initiator_ephemeral_public_key,
                 "recipient_device_id" => ^device_id,
                 "recipient_one_time_prekey" => nil,
                 "status" => "active"
               }
             ]
           } = json_response(refreshed_bootstrap_session_conn, 200)

    assert is_binary(refreshed_handshake_hash)
    refute refreshed_handshake_hash == handshake_hash

    recipient_devices_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/chats/#{chat_id}/recipient-devices")

    assert %{
             "recipient_devices" => [
               %{
                 "device_id" => ^device_id,
                 "encryption_public_key" => ^encryption_public_key
               }
             ]
           } = json_response(recipient_devices_conn, 200)

    prekey_lookup_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/users/alice/devices/prekeys")

    assert %{
             "devices" => [
               %{
                 "device_id" => ^device_id,
                 "encryption_public_key" => ^encryption_public_key,
                 "identity_public_key" => ^public_key,
                 "one_time_prekey" => ^one_time_prekey,
                 "signed_prekey" => ^signed_prekey,
                 "signed_prekey_signature" => ^signed_prekey_signature
               }
             ],
             "user" => %{"username" => "alice"}
           } = json_response(prekey_lookup_conn, 200)

    rotated_signed_prekey_raw = :crypto.strong_rand_bytes(65)
    rotated_signed_prekey = Base.encode64(rotated_signed_prekey_raw)

    rotated_signed_prekey_signature =
      rotated_signed_prekey_raw
      |> then(&:crypto.sign(:eddsa, :none, &1, [identity_private_key_raw, :ed25519]))
      |> Base.encode64()

    rotated_one_time_prekeys =
      Enum.map(1..2, fn _ -> Base.encode64(:crypto.strong_rand_bytes(65)) end)

    rotate_prekeys_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/devices/prekeys", %{
        signed_prekey: rotated_signed_prekey,
        signed_prekey_signature: rotated_signed_prekey_signature,
        one_time_prekeys: rotated_one_time_prekeys,
        replace_one_time_prekeys: true
      })

    assert %{
             "device_id" => ^device_id,
             "has_signed_prekey" => true,
             "one_time_prekey_count" => 2
           } = json_response(rotate_prekeys_conn, 200)

    refreshed_prekey_lookup_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/users/alice/devices/prekeys")

    assert %{
             "devices" => [
               %{
                 "device_id" => ^device_id,
                 "one_time_prekey" => refreshed_one_time_prekey,
                 "signed_prekey" => ^rotated_signed_prekey,
                 "signed_prekey_signature" => ^rotated_signed_prekey_signature
               }
             ]
           } = json_response(refreshed_prekey_lookup_conn, 200)

    assert refreshed_one_time_prekey in rotated_one_time_prekeys

    ciphertext = Base.encode64("opaque-ciphertext")
    recipient_envelope = Base.encode64("wrapped-message-key")
    header = Base.encode64(~s({"algorithm":"test"}))

    create_message_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/#{chat_id}/messages", %{
        client_id: "client-1",
        ciphertext: ciphertext,
        header: header,
        message_kind: "text",
        established_session_ids: [session_id],
        recipient_envelopes: %{
          device_id => recipient_envelope
        }
      })

    assert %{
             "message" => %{
               "id" => first_message_id,
               "ciphertext" => ^ciphertext,
               "header" => ^header,
               "message_kind" => "text",
               "reactions" => [],
               "recipient_envelope" => ^recipient_envelope,
               "sender_device_id" => ^device_id
             }
           } = json_response(create_message_conn, 201)

    established_bootstrap_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/#{chat_id}/session-bootstrap", %{})

    assert %{
             "sessions" => [
               %{
                 "established_at" => established_at,
                 "establishment_state" => "established",
                 "handshake_hash" => ^refreshed_handshake_hash,
                 "initiator_ephemeral_public_key" => ^rotated_initiator_ephemeral_public_key,
                 "id" => ^session_id
               }
             ]
           } = json_response(established_bootstrap_conn, 200)

    assert is_binary(established_at)
    refute established_at == ""

    ignored_rebootstrap_ephemeral_public_key = Base.encode64(:crypto.strong_rand_bytes(65))

    frozen_bootstrap_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/#{chat_id}/session-bootstrap", %{
        initiator_ephemeral_keys: %{
          device_id => ignored_rebootstrap_ephemeral_public_key
        }
      })

    assert %{
             "sessions" => [
               %{
                 "established_at" => ^established_at,
                 "establishment_state" => "established",
                 "handshake_hash" => ^refreshed_handshake_hash,
                 "id" => ^session_id,
                 "initiator_ephemeral_public_key" => ^rotated_initiator_ephemeral_public_key
               }
             ]
           } = json_response(frozen_bootstrap_conn, 200)

    explicit_rekey_ephemeral_public_key = Base.encode64(:crypto.strong_rand_bytes(65))

    explicit_rekey_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/#{chat_id}/session-rekey", %{
        initiator_ephemeral_keys: %{
          device_id => explicit_rekey_ephemeral_public_key
        }
      })

    assert %{"sessions" => rekeyed_sessions} = json_response(explicit_rekey_conn, 200)

    assert %{
             "established_at" => nil,
             "establishment_state" => "pending_first_message",
             "handshake_hash" => rekey_handshake_hash,
             "id" => rekeyed_session_id,
             "initiator_ephemeral_public_key" => ^explicit_rekey_ephemeral_public_key,
             "session_state" => "active",
             "superseded_at" => nil
           } =
             Enum.find(rekeyed_sessions, &(&1["session_state"] == "active"))

    assert %{
             "established_at" => ^established_at,
             "establishment_state" => "established",
             "handshake_hash" => ^refreshed_handshake_hash,
             "id" => ^session_id,
             "initiator_ephemeral_public_key" => ^rotated_initiator_ephemeral_public_key,
             "session_state" => "superseded",
             "superseded_at" => superseded_at
           } =
             Enum.find(rekeyed_sessions, &(&1["id"] == session_id))

    assert is_binary(rekey_handshake_hash)
    refute rekey_handshake_hash in [handshake_hash, refreshed_handshake_hash]
    refute rekeyed_session_id == session_id
    assert is_binary(superseded_at)
    refute superseded_at == ""

    react_message_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/#{chat_id}/messages/#{first_message_id}/reactions", %{
        reaction_key: "ACK"
      })

    assert %{
             "message" => %{
               "reactions" => [
                 %{
                   "count" => 1,
                   "reacted" => true,
                   "reaction_key" => "ACK"
                 }
               ]
             }
           } = json_response(react_message_conn, 200)

    reply_message_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/#{chat_id}/messages", %{
        client_id: "client-reply",
        ciphertext: ciphertext,
        header: header,
        message_kind: "text",
        reply_to_message_id: first_message_id,
        recipient_envelopes: %{
          device_id => recipient_envelope
        }
      })

    assert %{
             "message" => %{
               "id" => reply_message_id,
               "message_kind" => "text",
               "reply_to_message_id" => ^first_message_id
             }
           } = json_response(reply_message_conn, 201)

    edit_reply_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> patch("/api/v1/chats/#{chat_id}/messages/#{reply_message_id}", %{
        client_id: "client-reply",
        ciphertext: ciphertext,
        header: header,
        message_kind: "text",
        reply_to_message_id: first_message_id,
        recipient_envelopes: %{
          device_id => recipient_envelope
        }
      })

    assert %{
             "message" => %{
               "id" => ^reply_message_id,
               "edited_at" => edited_at,
               "reply_to_message_id" => ^first_message_id
             }
           } = json_response(edit_reply_conn, 200)

    assert is_binary(edited_at)

    pin_first_message_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/#{chat_id}/messages/#{first_message_id}/pin", %{})

    assert %{
             "message" => %{
               "id" => ^first_message_id,
               "pinned_at" => first_pinned_at
             }
           } = json_response(pin_first_message_conn, 200)

    assert is_binary(first_pinned_at)

    pin_reply_message_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/#{chat_id}/messages/#{reply_message_id}/pin", %{})

    assert %{
             "message" => %{
               "id" => ^reply_message_id,
               "pinned_at" => reply_pinned_at
             }
           } = json_response(pin_reply_message_conn, 200)

    assert is_binary(reply_pinned_at)

    attachment_message_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/#{chat_id}/messages", %{
        client_id: "client-attachment",
        ciphertext: ciphertext,
        header: header,
        message_kind: "attachment",
        recipient_envelopes: %{
          device_id => recipient_envelope
        }
      })

    assert %{
             "message" => %{
               "id" => attachment_message_id,
               "message_kind" => "attachment"
             }
           } = json_response(attachment_message_conn, 201)

    delete_attachment_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/#{chat_id}/messages/#{attachment_message_id}/delete", %{})

    assert %{
             "message" => %{
               "id" => ^attachment_message_id,
               "deleted_at" => deleted_at,
               "recipient_envelope" => nil
             }
           } = json_response(delete_attachment_conn, 200)

    assert is_binary(deleted_at)

    chats_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/chats")

    assert %{
             "chats" => [
               %{
                 "id" => ^chat_id,
                 "message_count" => 3
               }
             ]
           } = json_response(chats_conn, 200)

    messages_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/chats/#{chat_id}/messages")

    assert %{
             "messages" => [
               %{
                 "ciphertext" => ^ciphertext,
                 "header" => ^header,
                 "message_kind" => "text",
                 "pinned_at" => nil,
                 "edited_at" => nil,
                 "deleted_at" => nil,
                 "reactions" => [
                   %{
                     "count" => 1,
                     "reacted" => true,
                     "reaction_key" => "ACK"
                   }
                 ],
                 "recipient_envelope" => ^recipient_envelope,
                 "reply_to_message_id" => nil,
                 "sender_device_id" => ^device_id
               },
               %{
                 "message_kind" => "text",
                 "pinned_at" => ^reply_pinned_at,
                 "edited_at" => ^edited_at,
                 "deleted_at" => nil,
                 "reply_to_message_id" => ^first_message_id
               },
               %{
                 "message_kind" => "attachment",
                 "pinned_at" => nil,
                 "deleted_at" => ^deleted_at
               }
             ]
           } = json_response(messages_conn, 200)

    mark_read_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/#{chat_id}/read", %{
        last_read_message_id: reply_message_id
      })

    assert %{
             "read_state" => %{
               "chat_id" => ^chat_id,
               "device_id" => ^device_id,
               "last_read_message_id" => ^reply_message_id,
               "read_at" => read_at
             }
           } = json_response(mark_read_conn, 200)

    assert is_binary(read_at)

    mark_read_without_cursor_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/#{chat_id}/read", %{})

    assert %{
             "read_state" => %{
               "chat_id" => ^chat_id,
               "device_id" => ^device_id,
               "last_read_message_id" => ^reply_message_id
             }
           } = json_response(mark_read_without_cursor_conn, 200)
  end
end
