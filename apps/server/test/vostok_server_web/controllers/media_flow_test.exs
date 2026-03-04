defmodule VostokServerWeb.MediaFlowTest do
  use VostokServerWeb.ConnCase, async: false

  setup do
    previous = Application.get_env(:vostok_server, :registration_mode)
    Application.put_env(:vostok_server, :registration_mode, "open")
    on_exit(fn -> Application.put_env(:vostok_server, :registration_mode, previous) end)
    :ok
  end

  test "opaque encrypted media uploads can be created, appended, completed, and fetched", %{
    conn: conn
  } do
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
        username: "media-user",
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

    create_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/media/uploads", %{
        filename: "voice-note.enc",
        content_type: "application/octet-stream",
        declared_byte_size: 12,
        media_kind: "audio"
      })

    assert %{
             "upload" => %{
               "id" => upload_id,
               "status" => "pending",
               "uploaded_byte_size" => 0
             }
           } = json_response(create_conn, 201)

    part_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> patch("/api/v1/media/uploads/#{upload_id}/part", %{
        chunk: Base.encode64("encrypted-chunk")
      })

    assert %{
             "upload" => %{
               "id" => ^upload_id,
               "status" => "pending",
               "uploaded_byte_size" => uploaded_byte_size
             }
           } = json_response(part_conn, 200)

    assert uploaded_byte_size == byte_size("encrypted-chunk")

    complete_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/media/uploads/#{upload_id}/complete", %{})

    assert %{
             "upload" => %{
               "id" => ^upload_id,
               "status" => "completed",
               "completed_at" => completed_at
             }
           } = json_response(complete_conn, 200)

    assert is_binary(completed_at)

    show_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/media/#{upload_id}")

    assert %{
             "upload" => %{
               "id" => ^upload_id,
               "ciphertext" => ciphertext,
               "filename" => "voice-note.enc",
               "media_kind" => "audio",
               "status" => "completed"
             }
           } = json_response(show_conn, 200)

    assert ciphertext == Base.encode64("encrypted-chunk")
  end
end
