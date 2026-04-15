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
               %{"role" => "owner", "username" => "alice-group"},
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

    update_avatar_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> patch("/api/v1/chats/#{chat_id}/info", %{
        avatar_base64: Base.encode64("fake-avatar-bytes"),
        avatar_content_type: "image/png"
      })

    assert %{
             "chat" => %{
               "id" => ^chat_id,
               "avatar_url" => "/api/v1/chats/" <> ^chat_id <> "/avatar"
             }
           } = json_response(update_avatar_conn, 200)

    remove_avatar_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> patch("/api/v1/chats/#{chat_id}/info", %{
        remove_avatar: true
      })

    assert %{
             "chat" => %{
               "id" => ^chat_id,
               "avatar_url" => nil
             }
           } = json_response(remove_avatar_conn, 200)
  end

  test "group messages require signal-v2 transport with per-device envelopes", %{conn: conn} do
    %{token: alice_token, device_id: alice_device_id} = register_device(conn, "alice-group-transport")

    %{token: _bob_token, device_id: bob_device_id} =
      register_device(build_conn(), "bob-group-transport")

    create_group_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/group", %{
        title: "Transport Rules",
        members: ["bob-group-transport"]
      })

    assert %{"chat" => %{"id" => chat_id}} = json_response(create_group_conn, 201)

    missing_signal_transport_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/#{chat_id}/messages", %{
        client_id: "no-scheme-group-message",
        message_kind: "text",
        ciphertext: Base.encode64("opaque")
      })

    assert %{"error" => "validation", "message" => transport_error_message} =
             json_response(missing_signal_transport_conn, 422)

    assert String.contains?(
             transport_error_message,
             "Group messages must use crypto_scheme=signal-v2"
           )

    alice_envelope = Base.encode64("wrapped-for-alice")
    bob_envelope = Base.encode64("wrapped-for-bob")

    signal_group_message_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/#{chat_id}/messages", %{
        client_id: "signal-v2-group-message",
        message_kind: "text",
        crypto_scheme: "signal-v2",
        header: Base.encode64("{\"algorithm\":\"signal-v2\",\"kyber\":true}"),
        ciphertext: Base.encode64("group-ciphertext"),
        recipient_envelopes: %{
          alice_device_id => alice_envelope,
          bob_device_id => bob_envelope
        }
      })

    assert %{
             "message" => %{
               "client_id" => "signal-v2-group-message",
               "crypto_scheme" => "signal-v2",
               "recipient_envelope" => ^alice_envelope,
               "recipient_device_ids" => recipient_device_ids
             }
           } = json_response(signal_group_message_conn, 201)

    assert Enum.sort(recipient_device_ids) == Enum.sort([alice_device_id, bob_device_id])
  end

  test "group message permissions enforce admin pinning and admin-or-owner delete", %{conn: conn} do
    %{token: alice_token, device_id: alice_device_id} = register_device(conn, "alice-group-perms")
    %{token: bob_token, device_id: bob_device_id} = register_device(build_conn(), "bob-group-perms")

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
        crypto_scheme: "signal-v2",
        ciphertext: Base.encode64("member-message"),
        recipient_envelopes: %{
          alice_device_id => Base.encode64("wrapped-for-alice"),
          bob_device_id => Base.encode64("wrapped-for-bob")
        }
      })

    assert %{"message" => %{"id" => message_id}} = json_response(bob_message_conn, 201)

    bob_pin_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{bob_token}")
      |> post("/api/v1/chats/#{chat_id}/messages/#{message_id}/pin", %{})

    assert %{"error" => "validation", "message" => pin_error} = json_response(bob_pin_conn, 422)
    assert String.contains?(pin_error, "Only permitted members can pin messages")

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
        crypto_scheme: "signal-v2",
        ciphertext: Base.encode64("admin-cannot-edit-member"),
        recipient_envelopes: %{
          alice_device_id => Base.encode64("wrapped-edit-for-alice"),
          bob_device_id => Base.encode64("wrapped-edit-for-bob")
        }
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

  test "invite links allow joining private chats and channel views deduplicate per user", %{conn: conn} do
    %{token: alice_token, device_id: alice_device_id} = register_device(conn, "alice-invite")
    %{token: bob_token, device_id: bob_device_id} = register_device(build_conn(), "bob-invite")

    create_channel_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/channel", %{
        title: "Private Recipes",
        allow_comments: true
      })

    assert %{"chat" => %{"id" => chat_id}} = json_response(create_channel_conn, 201)

    create_invite_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/#{chat_id}/invite-links", %{"max_uses" => 3})

    assert %{"invite_link" => %{"code" => code}} = json_response(create_invite_conn, 201)

    join_via_invite_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{bob_token}")
      |> post("/api/v1/invite-links/#{code}/join", %{})

    assert %{"chat" => %{"id" => ^chat_id}} = json_response(join_via_invite_conn, 200)

    post_message_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/#{chat_id}/messages", %{
        client_id: "channel-post-1",
        message_kind: "text",
        crypto_scheme: "signal-v2",
        ciphertext: Base.encode64("channel-post"),
        recipient_envelopes: %{
          alice_device_id => Base.encode64("wrapped-for-alice"),
          bob_device_id => Base.encode64("wrapped-for-bob")
        }
      })

    assert %{"message" => %{"id" => message_id}} = json_response(post_message_conn, 201)

    first_view_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{bob_token}")
      |> post("/api/v1/chats/#{chat_id}/messages/#{message_id}/view", %{})

    assert %{"message_id" => ^message_id, "view_count" => 1} = json_response(first_view_conn, 200)

    second_view_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{bob_token}")
      |> post("/api/v1/chats/#{chat_id}/messages/#{message_id}/view", %{})

    assert %{"message_id" => ^message_id, "view_count" => 1} = json_response(second_view_conn, 200)
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

    kyber_prekey_raw = :crypto.strong_rand_bytes(1568)
    kyber_prekey = Base.encode64(kyber_prekey_raw)

    kyber_prekey_signature =
      kyber_prekey_raw
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
        kyber_prekey: kyber_prekey,
        kyber_prekey_signature: kyber_prekey_signature,
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
