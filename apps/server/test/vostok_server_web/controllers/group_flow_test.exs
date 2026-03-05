defmodule VostokServerWeb.GroupFlowTest do
  use VostokServerWeb.ConnCase, async: false

  setup do
    previous = Application.get_env(:vostok_server, :registration_mode)
    Application.put_env(:vostok_server, :registration_mode, "open")
    on_exit(fn -> Application.put_env(:vostok_server, :registration_mode, previous) end)
    :ok
  end

  test "a group chat can be created with existing members", %{conn: conn} do
    %{token: alice_token} = register_device(conn, "alice-group")
    %{user_id: bob_user_id} = register_device(build_conn(), "bob-group")
    %{user_id: charlie_user_id} = register_device(build_conn(), "charlie-group")

    create_group_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/group", %{
        title: "Operators",
        members: ["bob-group", "charlie-group"]
      })

    assert %{
             "chat" => %{
               "id" => chat_id,
               "type" => "group",
               "title" => "Operators",
               "participant_usernames" => participants
             }
           } = json_response(create_group_conn, 201)

    assert Enum.sort(participants) == ["alice-group", "bob-group", "charlie-group"]

    rename_group_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> patch("/api/v1/chats/#{chat_id}/group", %{
        title: "Operators West"
      })

    assert %{
             "chat" => %{
               "id" => ^chat_id,
               "title" => "Operators West",
               "type" => "group"
             }
           } = json_response(rename_group_conn, 200)

    list_members_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> get("/api/v1/chats/#{chat_id}/members")

    assert %{
             "members" => [
               %{"role" => "admin", "username" => "alice-group"},
               %{"role" => "member", "user_id" => ^bob_user_id, "username" => "bob-group"},
               %{"role" => "member", "user_id" => ^charlie_user_id, "username" => "charlie-group"}
             ]
           } = json_response(list_members_conn, 200)

    promote_bob_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> patch("/api/v1/chats/#{chat_id}/members/#{bob_user_id}", %{
        role: "admin"
      })

    assert %{
             "member" => %{
               "role" => "admin",
               "user_id" => ^bob_user_id,
               "username" => "bob-group"
             }
           } = json_response(promote_bob_conn, 200)

    remove_charlie_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/#{chat_id}/members/#{charlie_user_id}/remove", %{})

    assert %{
             "member" => %{
               "user_id" => ^charlie_user_id,
               "username" => "charlie-group"
             }
           } = json_response(remove_charlie_conn, 200)
  end

  test "group sender keys can be distributed and fetched by recipient devices", %{conn: conn} do
    %{token: alice_token} = register_device(conn, "alice-sender")
    %{token: bob_token, device_id: bob_device_id} = register_device(build_conn(), "bob-sender")

    %{token: charlie_token, device_id: charlie_device_id} =
      register_device(build_conn(), "charlie-sender")

    create_group_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/group", %{
        title: "Sender Keys",
        members: ["bob-sender", "charlie-sender"]
      })

    assert %{
             "chat" => %{
               "id" => chat_id
             }
           } = json_response(create_group_conn, 201)

    bob_wrapped_key = Base.encode64("wrapped-for-bob")
    charlie_wrapped_key = Base.encode64("wrapped-for-charlie")

    distribute_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/#{chat_id}/sender-keys", %{
        key_id: "sender-key-1",
        algorithm: "x25519+sealedbox",
        wrapped_keys: %{
          bob_device_id => bob_wrapped_key,
          charlie_device_id => charlie_wrapped_key
        }
      })

    assert %{
             "sender_keys" => sender_keys
           } = json_response(distribute_conn, 201)

    assert length(sender_keys) == 2

    bob_list_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{bob_token}")
      |> get("/api/v1/chats/#{chat_id}/sender-keys")

    assert %{
             "sender_keys" => [
               %{
                 "key_id" => "sender-key-1",
                 "recipient_device_id" => ^bob_device_id,
                 "wrapped_sender_key" => ^bob_wrapped_key,
                 "status" => "active"
               }
             ]
           } = json_response(bob_list_conn, 200)

    charlie_list_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{charlie_token}")
      |> get("/api/v1/chats/#{chat_id}/sender-keys")

    assert %{
             "sender_keys" => [
               %{
                 "key_id" => "sender-key-1",
                 "recipient_device_id" => ^charlie_device_id,
                 "wrapped_sender_key" => ^charlie_wrapped_key,
                 "status" => "active"
               }
             ]
           } = json_response(charlie_list_conn, 200)
  end

  test "group messages require sender-key transport unless explicit fallback is set", %{
    conn: conn
  } do
    %{token: alice_token} = register_device(conn, "alice-group-transport")

    %{token: bob_token, device_id: bob_device_id} =
      register_device(build_conn(), "bob-group-transport")

    create_group_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/group", %{
        title: "Transport Rules",
        members: ["bob-group-transport"]
      })

    assert %{"chat" => %{"id" => chat_id}} = json_response(create_group_conn, 201)

    distribute_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/#{chat_id}/sender-keys", %{
        key_id: "sender-key-transport",
        sender_key_epoch: 1,
        algorithm: "p256-ecdh+a256gcm",
        wrapped_keys: %{
          bob_device_id => Base.encode64("wrapped-for-bob")
        }
      })

    assert %{"sender_keys" => [_]} = json_response(distribute_conn, 201)

    legacy_group_message_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/#{chat_id}/messages", %{
        client_id: "legacy-group-message",
        message_kind: "text",
        ciphertext: Base.encode64("legacy-ciphertext")
      })

    assert %{"error" => "validation", "message" => legacy_error_message} =
             json_response(legacy_group_message_conn, 422)

    assert String.contains?(
             legacy_error_message,
             "Group messages must use crypto_scheme=group_sender_key_v1"
           )

    sender_key_message_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/#{chat_id}/messages", %{
        client_id: "sender-key-group-message",
        message_kind: "text",
        crypto_scheme: "group_sender_key_v1",
        sender_key_id: "sender-key-transport",
        sender_key_epoch: 1,
        header: Base.encode64("{\"algorithm\":\"vostok-group-sender-key-v1\"}"),
        ciphertext: Base.encode64("group-ciphertext")
      })

    assert %{
             "message" => %{
               "client_id" => "sender-key-group-message",
               "crypto_scheme" => "group_sender_key_v1",
               "sender_key_id" => "sender-key-transport",
               "sender_key_epoch" => 1
             }
           } = json_response(sender_key_message_conn, 201)

    # The recipient can still fetch the active sender key state for decryptability.
    bob_sender_key_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{bob_token}")
      |> get("/api/v1/chats/#{chat_id}/sender-keys")

    assert %{"sender_keys" => [%{"key_id" => "sender-key-transport"}]} =
             json_response(bob_sender_key_conn, 200)
  end

  test "group message permissions enforce admin pinning and admin-or-owner delete", %{conn: conn} do
    %{token: alice_token} = register_device(conn, "alice-group-perms")
    %{token: bob_token} = register_device(build_conn(), "bob-group-perms")

    create_group_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/group", %{
        title: "Moderated Group",
        members: ["bob-group-perms"]
      })

    assert %{"chat" => %{"id" => chat_id}} = json_response(create_group_conn, 201)

    bob_message_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{bob_token}")
      |> post("/api/v1/chats/#{chat_id}/messages", %{
        client_id: "bob-group-perms-message",
        message_kind: "text",
        group_transport_fallback: true,
        ciphertext: Base.encode64("member-message")
      })

    assert %{"message" => %{"id" => message_id}} = json_response(bob_message_conn, 201)

    bob_pin_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{bob_token}")
      |> post("/api/v1/chats/#{chat_id}/messages/#{message_id}/pin", %{})

    assert %{"error" => "validation", "message" => pin_error} = json_response(bob_pin_conn, 422)
    assert String.contains?(pin_error, "Only group admins can update this chat.")

    alice_pin_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/#{chat_id}/messages/#{message_id}/pin", %{})

    assert %{"message" => %{"id" => ^message_id, "pinned_at" => pinned_at}} =
             json_response(alice_pin_conn, 200)

    assert is_binary(pinned_at)

    alice_edit_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> patch("/api/v1/chats/#{chat_id}/messages/#{message_id}", %{
        client_id: "alice-edit-foreign-message",
        message_kind: "text",
        group_transport_fallback: true,
        ciphertext: Base.encode64("admin-cannot-edit-member")
      })

    assert %{"error" => "validation", "message" => edit_error} =
             json_response(alice_edit_conn, 422)

    assert String.contains?(edit_error, "Only the sending device can modify this message.")

    alice_delete_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/#{chat_id}/messages/#{message_id}/delete", %{})

    assert %{"message" => %{"id" => ^message_id, "deleted_at" => deleted_at}} =
             json_response(alice_delete_conn, 200)

    assert is_binary(deleted_at)
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
             "user" => %{"id" => user_id},
             "device" => %{"id" => device_id}
           } = json_response(register_conn, 201)

    %{token: token, user_id: user_id, device_id: device_id}
  end
end
