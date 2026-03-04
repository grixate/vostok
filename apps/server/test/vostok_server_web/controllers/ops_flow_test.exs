defmodule VostokServerWeb.OpsFlowTest do
  use VostokServerWeb.ConnCase, async: false

  setup do
    previous = Application.get_env(:vostok_server, :registration_mode)
    Application.put_env(:vostok_server, :registration_mode, "open")
    on_exit(fn -> Application.put_env(:vostok_server, :registration_mode, previous) end)
    :ok
  end

  test "admin overview, federation peer scaffolding, and turn credentials are available", %{
    conn: conn
  } do
    %{device_id: current_device_id, token: token} = register_device(conn, "ops-user")

    overview_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/admin/overview")

    assert %{
             "overview" => %{
               "users" => users,
               "federation_peers" => 0,
               "queued_federation_deliveries" => 0
             }
           } = json_response(overview_conn, 200)

    assert users >= 1

    create_peer_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/admin/federation/peers", %{
        domain: "chat.remote.example",
        display_name: "Remote Example"
      })

    assert %{
             "peer" => %{
               "id" => peer_id,
               "domain" => "chat.remote.example",
               "display_name" => "Remote Example",
               "status" => "pending"
             }
           } = json_response(create_peer_conn, 201)

    activate_peer_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/admin/federation/peers/#{peer_id}/status", %{status: "active"})

    assert %{
             "peer" => %{
               "id" => ^peer_id,
               "status" => "active"
             }
           } = json_response(activate_peer_conn, 200)

    heartbeat_peer_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/admin/federation/peers/#{peer_id}/heartbeat", %{})

    assert %{
             "peer" => %{
               "id" => ^peer_id,
               "status" => "active",
               "last_seen_at" => last_seen_at
             }
           } = json_response(heartbeat_peer_conn, 200)

    assert is_binary(last_seen_at)

    list_peers_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/admin/federation/peers")

    assert %{
             "peers" => [
               %{
                 "domain" => "chat.remote.example",
                 "status" => "active"
               }
             ]
           } = json_response(list_peers_conn, 200)

    queue_delivery_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/admin/federation/peers/#{peer_id}/deliveries", %{
        event_type: "message_relay",
        payload: %{
          envelope_id: "env-1",
          chat_id: "chat-1"
        }
      })

    assert %{
             "delivery" => %{
               "id" => delivery_job_id,
               "peer_id" => ^peer_id,
               "event_type" => "message_relay",
               "status" => "queued",
               "attempt_count" => 0
             }
           } = json_response(queue_delivery_conn, 201)

    list_deliveries_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/admin/federation/deliveries")

    assert %{
             "deliveries" => [
               %{
                 "id" => ^delivery_job_id,
                 "status" => "queued"
               }
             ]
           } = json_response(list_deliveries_conn, 200)

    fail_delivery_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/admin/federation/deliveries/#{delivery_job_id}/attempt", %{
        outcome: "failed",
        last_error: "Peer was offline"
      })

    assert %{
             "delivery" => %{
               "id" => ^delivery_job_id,
               "status" => "failed",
               "attempt_count" => 1,
               "last_error" => "Peer was offline"
             }
           } = json_response(fail_delivery_conn, 200)

    deliver_delivery_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/admin/federation/deliveries/#{delivery_job_id}/attempt", %{
        outcome: "delivered"
      })

    assert %{
             "delivery" => %{
               "id" => ^delivery_job_id,
               "status" => "delivered",
               "attempt_count" => 2,
               "delivered_at" => delivered_at
             }
           } = json_response(deliver_delivery_conn, 200)

    assert is_binary(delivered_at)

    turn_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/calls/turn-credentials", %{
        ttl_seconds: 600
      })

    assert %{
             "turn" => %{
               "password" => password,
               "ttl_seconds" => 600,
               "uris" => uris,
               "username" => username
             }
           } = json_response(turn_conn, 200)

    assert is_binary(password)
    assert is_binary(username)
    assert is_list(uris)

    create_chat_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/direct", %{username: "ops-user"})

    assert %{
             "chat" => %{
               "id" => chat_id
             }
           } = json_response(create_chat_conn, 201)

    create_call_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/chats/#{chat_id}/calls", %{mode: "voice"})

    assert %{
             "call" => %{
               "chat_id" => ^chat_id,
               "id" => call_id,
               "mode" => "voice",
               "status" => "active"
             }
           } = json_response(create_call_conn, 201)

    active_call_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/chats/#{chat_id}/calls/active")

    assert %{
             "call" => %{
               "id" => ^call_id,
               "status" => "active"
             }
           } = json_response(active_call_conn, 200)

    join_call_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/calls/#{call_id}/join", %{track_kind: "audio"})

    assert %{
             "call" => %{
               "id" => ^call_id,
               "status" => "active"
             },
             "participant" => %{
               "call_id" => ^call_id,
               "status" => "joined",
               "track_kind" => "audio"
             },
             "participants" => [
               %{
                 "call_id" => ^call_id,
                 "status" => "joined"
               }
             ],
             "room" => %{
               "backend" => "membrane_rtc_engine",
               "call_id" => ^call_id,
               "endpoint_count" => endpoint_count,
               "forwarded_track_count" => forwarded_track_count,
               "mode" => "voice",
               "participant_count" => 1,
               "track_count" => track_count,
               "webrtc_endpoint_count" => 1
             }
           } = json_response(join_call_conn, 200)

    assert is_integer(endpoint_count)
    assert is_integer(forwarded_track_count)
    assert is_integer(track_count)

    provision_endpoint_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/calls/#{call_id}/webrtc-endpoint", %{})

    assert %{
             "call" => %{
               "id" => ^call_id
             },
             "endpoint" => %{
               "endpoint_id" => ^current_device_id,
               "exists" => true,
               "pending_media_event_count" => 0
             },
             "room" => %{
               "backend" => "membrane_rtc_engine",
               "webrtc_endpoint_count" => 1
             }
           } = json_response(provision_endpoint_conn, 200)

    endpoint_state_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/calls/#{call_id}/webrtc-endpoint")

    assert %{
             "call" => %{
               "id" => ^call_id
             },
             "endpoint" => %{
               "endpoint_id" => ^current_device_id,
               "exists" => true,
               "pending_media_event_count" => 0
             },
             "room" => %{
               "backend" => "membrane_rtc_engine"
             }
           } = json_response(endpoint_state_conn, 200)

    push_media_event_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/calls/#{call_id}/webrtc-endpoint/media-events", %{
        event: ~s({"type":"connect","data":{"metadata":{"via":"ops-test"}}})
      })

    assert %{
             "call" => %{
               "id" => ^call_id
             },
             "endpoint" => %{
               "endpoint_id" => ^current_device_id,
               "exists" => true
             },
             "media_events" => media_events
           } = json_response(push_media_event_conn, 200)

    assert is_list(media_events)

    poll_media_events_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/calls/#{call_id}/webrtc-endpoint/poll", %{})

    assert %{
             "call" => %{
               "id" => ^call_id
             },
             "endpoint" => %{
               "endpoint_id" => ^current_device_id,
               "exists" => true
             },
             "media_events" => polled_media_events
           } = json_response(poll_media_events_conn, 200)

    assert is_list(polled_media_events)

    call_state_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/calls/#{call_id}")

    assert %{
             "call" => %{
               "id" => ^call_id
             },
             "participants" => [
               %{
                 "status" => "joined"
               }
             ],
             "signals" => [],
             "room" => %{
               "backend" => "membrane_rtc_engine",
               "endpoint_count" => endpoint_count,
               "forwarded_track_count" => forwarded_track_count,
               "participant_count" => 1
             }
           } = json_response(call_state_conn, 200)

    assert is_integer(endpoint_count)
    assert is_integer(forwarded_track_count)

    emit_signal_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/calls/#{call_id}/signals", %{
        signal_type: "offer",
        payload: ~s({"sdp":"offer-sdp","type":"offer"}),
        target_device_id: current_device_id
      })

    assert %{
             "call" => %{
               "id" => ^call_id
             },
             "signal" => %{
               "call_id" => ^call_id,
               "from_device_id" => from_device_id,
               "target_device_id" => ^current_device_id,
               "signal_type" => "offer",
               "payload" => "{\"sdp\":\"offer-sdp\",\"type\":\"offer\"}"
             }
           } = json_response(emit_signal_conn, 201)

    assert is_binary(from_device_id)

    list_signals_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/calls/#{call_id}/signals")

    assert %{
             "call" => %{
               "id" => ^call_id
             },
             "signals" => [
               %{
                 "call_id" => ^call_id,
                 "signal_type" => "offer"
               }
             ]
           } = json_response(list_signals_conn, 200)

    poll_signal_bridge_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/calls/#{call_id}/webrtc-endpoint/poll", %{})

    assert %{
             "call" => %{
               "id" => ^call_id
             },
             "endpoint" => %{
               "endpoint_id" => ^current_device_id,
               "exists" => true
             },
             "media_events" => media_events
           } = json_response(poll_signal_bridge_conn, 200)

    signal_bridge_event =
      Enum.find(media_events, &String.contains?(&1, "\"kind\":\"call_signal_bridge\""))

    assert is_binary(signal_bridge_event)
    assert String.contains?(signal_bridge_event, "\"kind\":\"call_signal_bridge\"")
    assert String.contains?(signal_bridge_event, "\"signal_type\":\"offer\"")

    leave_call_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/calls/#{call_id}/leave", %{})

    assert %{
             "participant" => %{
               "call_id" => ^call_id,
               "status" => "left"
             },
             "participants" => [
               %{
                 "status" => "left"
               }
             ],
             "room" => %{
               "participant_count" => 0,
               "webrtc_endpoint_count" => 0
             }
           } = json_response(leave_call_conn, 200)

    endpoint_after_leave_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/calls/#{call_id}/webrtc-endpoint")

    assert %{
             "endpoint" => %{
               "endpoint_id" => ^current_device_id,
               "exists" => false,
               "pending_media_event_count" => 0
             }
           } = json_response(endpoint_after_leave_conn, 200)

    end_call_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/calls/#{call_id}/end", %{})

    assert %{
             "call" => %{
               "id" => ^call_id,
               "status" => "ended"
             }
           } = json_response(end_call_conn, 200)

    messages_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/chats/#{chat_id}/messages")

    assert %{
             "messages" => [
               %{
                 "message_kind" => "system",
                 "ciphertext" => first_system_ciphertext
               },
               %{
                 "message_kind" => "system",
                 "ciphertext" => second_system_ciphertext
               }
             ]
           } = json_response(messages_conn, 200)

    assert Base.decode64!(first_system_ciphertext) == "Voice call started"
    assert Base.decode64!(second_system_ciphertext) == "Missed voice call"
  end

  test "untargeted call signals fan out to joined participant endpoints", %{conn: conn} do
    %{device_id: alice_device_id, token: alice_token} = register_device(conn, "alice-ops")
    %{device_id: bob_device_id, token: bob_token} = register_device(conn, "bob-ops")

    create_chat_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/direct", %{username: "bob-ops"})

    assert %{
             "chat" => %{
               "id" => chat_id
             }
           } = json_response(create_chat_conn, 201)

    create_call_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/#{chat_id}/calls", %{mode: "voice"})

    assert %{
             "call" => %{
               "id" => call_id
             }
           } = json_response(create_call_conn, 201)

    alice_join_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/calls/#{call_id}/join", %{track_kind: "audio"})

    assert %{
             "room" => %{
               "participant_count" => 1,
               "webrtc_endpoint_count" => 1
             }
           } = json_response(alice_join_conn, 200)

    bob_join_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{bob_token}")
      |> post("/api/v1/calls/#{call_id}/join", %{track_kind: "audio"})

    assert %{
             "room" => %{
               "participant_count" => 2,
               "webrtc_endpoint_count" => 2
             }
           } = json_response(bob_join_conn, 200)

    emit_signal_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/calls/#{call_id}/signals", %{
        signal_type: "offer",
        payload: ~s({"sdp":"broadcast-offer","type":"offer"})
      })

    assert %{
             "signal" => %{
               "from_device_id" => ^alice_device_id,
               "target_device_id" => nil,
               "signal_type" => "offer"
             }
           } = json_response(emit_signal_conn, 201)

    bob_poll_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{bob_token}")
      |> post("/api/v1/calls/#{call_id}/webrtc-endpoint/poll", %{})

    assert %{
             "endpoint" => %{
               "endpoint_id" => ^bob_device_id,
               "exists" => true
             },
             "media_events" => [bob_bridge_event]
           } = json_response(bob_poll_conn, 200)

    assert String.contains?(bob_bridge_event, "\"kind\":\"call_signal_bridge\"")
    assert String.contains?(bob_bridge_event, "\"signal_type\":\"offer\"")

    alice_poll_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/calls/#{call_id}/webrtc-endpoint/poll", %{})

    assert %{
             "endpoint" => %{
               "endpoint_id" => ^alice_device_id,
               "exists" => true
             },
             "media_events" => []
           } = json_response(alice_poll_conn, 200)

    end_call_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/calls/#{call_id}/end", %{})

    assert %{
             "call" => %{
               "id" => ^call_id,
               "status" => "ended"
             }
           } = json_response(end_call_conn, 200)

    messages_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> get("/api/v1/chats/#{chat_id}/messages")

    assert %{
             "messages" => [
               %{
                 "message_kind" => "system",
                 "ciphertext" => first_system_ciphertext
               },
               %{
                 "message_kind" => "system",
                 "ciphertext" => second_system_ciphertext
               }
             ]
           } = json_response(messages_conn, 200)

    assert Base.decode64!(first_system_ciphertext) == "Voice call started"
    assert Base.decode64!(second_system_ciphertext) == "Voice call ended"
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
             "device" => %{"id" => device_id},
             "session" => %{"token" => token}
           } = json_response(register_conn, 201)

    %{device_id: device_id, token: token}
  end
end
