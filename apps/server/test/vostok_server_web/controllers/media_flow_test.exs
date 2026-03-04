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
    %{token: token} = register_device(conn, "media-user")

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

  test "multipart uploads support indexed parts, resumable progress, and deterministic assembly", %{
    conn: conn
  } do
    %{token: token} = register_device(conn, "media-multipart")

    create_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/media/uploads", %{
        filename: "round-video.enc",
        content_type: "application/octet-stream",
        declared_byte_size: 9,
        expected_part_count: 3,
        media_kind: "video"
      })

    assert %{
             "upload" => %{
               "id" => upload_id,
               "expected_part_count" => 3,
               "uploaded_part_count" => 0,
               "uploaded_part_indexes" => []
             }
           } = json_response(create_conn, 201)

    part_two_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> patch("/api/v1/media/uploads/#{upload_id}/part", %{
        chunk: Base.encode64("CCC"),
        part_index: 2,
        part_count: 3
      })

    assert %{
             "upload" => %{
               "uploaded_part_count" => 1,
               "uploaded_part_indexes" => [2],
               "uploaded_byte_size" => 3
             }
           } = json_response(part_two_conn, 200)

    part_zero_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> patch("/api/v1/media/uploads/#{upload_id}/part", %{
        chunk: Base.encode64("AAA"),
        part_index: 0,
        part_count: 3
      })

    assert %{
             "upload" => %{
               "uploaded_part_count" => 2,
               "uploaded_part_indexes" => [0, 2],
               "uploaded_byte_size" => 6
             }
           } = json_response(part_zero_conn, 200)

    duplicate_part_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> patch("/api/v1/media/uploads/#{upload_id}/part", %{
        chunk: Base.encode64("CCC"),
        part_index: 2,
        part_count: 3
      })

    assert %{
             "upload" => %{
               "uploaded_part_count" => 2,
               "uploaded_part_indexes" => [0, 2],
               "uploaded_byte_size" => 6
             }
           } = json_response(duplicate_part_conn, 200)

    part_one_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> patch("/api/v1/media/uploads/#{upload_id}/part", %{
        chunk: Base.encode64("BBB"),
        part_index: 1,
        part_count: 3
      })

    assert %{
             "upload" => %{
               "uploaded_part_count" => 3,
               "uploaded_part_indexes" => [0, 1, 2],
               "uploaded_byte_size" => 9
             }
           } = json_response(part_one_conn, 200)

    complete_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/media/uploads/#{upload_id}/complete", %{})

    assert %{
             "upload" => %{
               "id" => ^upload_id,
               "status" => "completed",
               "uploaded_part_count" => 3,
               "uploaded_part_indexes" => [0, 1, 2],
               "ciphertext" => nil
             }
           } = json_response(complete_conn, 200)

    show_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> get("/api/v1/media/#{upload_id}")

    assert %{
             "upload" => %{
               "ciphertext" => ciphertext
             }
           } = json_response(show_conn, 200)

    assert ciphertext == Base.encode64("AAABBBCCC")
  end

  test "link metadata endpoint rejects private targets", %{conn: conn} do
    %{token: token} = register_device(conn, "media-link-check")

    localhost_conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token}")
      |> post("/api/v1/media/link-metadata", %{"url" => "http://localhost:4000/private"})

    assert %{
             "error" => "validation",
             "message" => message
           } = json_response(localhost_conn, 422)

    assert String.contains?(message, "Localhost metadata fetches are blocked")
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
