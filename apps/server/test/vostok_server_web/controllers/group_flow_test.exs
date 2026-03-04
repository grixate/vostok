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
    _bob = register_device(build_conn(), "bob-group")

    create_group_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{alice_token}")
      |> post("/api/v1/chats/group", %{
        title: "Operators",
        members: ["bob-group"]
      })

    assert %{
             "chat" => %{
               "type" => "group",
               "title" => "Operators",
               "participant_usernames" => participants
             }
           } = json_response(create_group_conn, 201)

    assert Enum.sort(participants) == ["alice-group", "bob-group"]
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
             "session" => %{"token" => token}
           } = json_response(register_conn, 201)

    %{token: token}
  end
end
