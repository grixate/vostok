defmodule VostokServerWeb.CallRoomFlowTest do
  use VostokServerWeb.ConnCase, async: false

  setup do
    previous = Application.get_env(:vostok_server, :registration_mode)
    Application.put_env(:vostok_server, :registration_mode, "open")
    on_exit(fn -> Application.put_env(:vostok_server, :registration_mode, previous) end)
    :ok
  end

  test "ephemeral call rooms can be created, inspected, and started", %{conn: conn} do
    %{token: alice_token, user_id: alice_user_id} = register_device(conn, "alice-call-room")
    %{user_id: bob_user_id} = register_device(build_conn(), "bob-call-room")

    create_room_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/call-rooms", %{
        title: "Launch Room",
        participant_user_ids: [bob_user_id]
      })

    assert %{
             "room" => %{
               "id" => room_id,
               "title" => "Launch Room",
               "created_by_user_id" => ^alice_user_id
             },
             "members" => members
           } = json_response(create_room_conn, 201)

    assert Enum.count(members) == 2
    assert Enum.any?(members, &(&1["user_id"] == bob_user_id))

    show_room_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> get("/api/v1/call-rooms/#{room_id}")

    assert %{
             "room" => %{"id" => ^room_id},
             "active_call" => nil
           } = json_response(show_room_conn, 200)

    create_call_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/call-rooms/#{room_id}/calls", %{
        media_mode: "video"
      })

    assert %{
             "call" => %{
               "id" => call_id,
               "scope_type" => "call_room",
               "scope_id" => ^room_id,
               "call_room_id" => ^room_id,
               "mode" => "group",
               "media_mode" => "video",
               "status" => "ringing"
             }
           } = json_response(create_call_conn, 201)

    active_call_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> get("/api/v1/call-rooms/#{room_id}/calls/active")

    assert %{
             "call" => %{
               "id" => ^call_id,
               "scope_type" => "call_room",
               "status" => "ringing"
             }
           } = json_response(active_call_conn, 200)
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
             "user" => %{"id" => user_id},
             "session" => %{"token" => token}
           } = json_response(register_conn, 201)

    %{device_id: device_id, token: token, user_id: user_id}
  end
end
