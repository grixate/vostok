defmodule VostokServerWeb.TopicChannelTest do
  use VostokServerWeb.ChannelCase, async: false

  alias VostokServer.Identity
  alias VostokServer.Calls
  alias VostokServer.Messaging
  alias VostokServerWeb.{DeviceSocket, TopicChannel}

  setup do
    previous = Application.get_env(:vostok_server, :registration_mode)
    Application.put_env(:vostok_server, :registration_mode, "open")
    on_exit(fn -> Application.put_env(:vostok_server, :registration_mode, previous) end)
    :ok
  end

  test "chat members can join the chat topic and receive message broadcasts" do
    alice = register_identity("alice")
    {:ok, chat} = Messaging.ensure_direct_chat(alice.user.id, alice.user.username)
    chat_id = chat.id
    topic_name = "chat:#{chat_id}"

    assert {:ok, %{status: "connected", topic: "chat:" <> _chat_id}, socket} =
             DeviceSocket
             |> socket("device_socket:#{alice.device.id}", %{
               device_id: alice.device.id,
               device_token: "test-token",
               user_id: alice.user.id
             })
             |> subscribe_and_join(TopicChannel, topic_name)

    assert_reply push(socket, "ping", %{"check" => "ok"}), :ok, %{
      "check" => "ok",
      "topic" => ^topic_name
    }

    ciphertext = Base.encode64("opaque-ciphertext")

    assert {:ok, message} =
             Messaging.create_message(
               chat_id,
               alice.device.id,
               alice.user.id,
               %{
                 "ciphertext" => ciphertext,
                 "client_id" => "client-#{System.unique_integer([:positive])}",
                 "message_kind" => "text"
               },
               alice.device.id
             )

    message_id = message.id

    assert_broadcast "message:new", %{
      chat_id: ^chat_id,
      message_id: ^message_id
    }
  end

  test "non-members cannot join chat topics" do
    alice = register_identity("alice")
    eve = register_identity("eve")
    {:ok, chat} = Messaging.ensure_direct_chat(alice.user.id, alice.user.username)
    chat_id = chat.id

    assert {:error, %{reason: "unauthorized"}} =
             DeviceSocket
             |> socket("device_socket:#{eve.device.id}", %{
               device_id: eve.device.id,
               device_token: "test-token",
               user_id: eve.user.id
             })
             |> subscribe_and_join(TopicChannel, "chat:#{chat_id}")
  end

  test "chat members can join the call topic and receive call state broadcasts" do
    alice = register_identity("alice")
    {:ok, chat} = Messaging.ensure_direct_chat(alice.user.id, alice.user.username)
    chat_id = chat.id

    assert {:ok, %{status: "connected", topic: "call:" <> _chat_id}, _socket} =
             DeviceSocket
             |> socket("device_socket:#{alice.device.id}", %{
               device_id: alice.device.id,
               device_token: "test-token",
               user_id: alice.user.id
             })
             |> subscribe_and_join(TopicChannel, "call:#{chat_id}")

    assert {:ok, call} =
             Calls.start_call(chat_id, alice.user.id, alice.device.id, %{
               "mode" => "voice"
             })

    call_id = call.id

    assert_broadcast "call:state", %{
      call: %{
        chat_id: ^chat_id,
        id: ^call_id,
        status: "active"
      }
    }

    assert {:ok, _ended_call} = Calls.end_call(call_id, alice.user.id)

    assert_broadcast "call:state", %{
      call: %{
        chat_id: ^chat_id,
        id: ^call_id,
        status: "ended"
      }
    }
  end

  test "call topics receive participant state broadcasts from the membrane room scaffold" do
    alice = register_identity("alice")
    {:ok, chat} = Messaging.ensure_direct_chat(alice.user.id, alice.user.username)
    chat_id = chat.id

    assert {:ok, %{status: "connected", topic: "call:" <> _chat_id}, _socket} =
             DeviceSocket
             |> socket("device_socket:#{alice.device.id}", %{
               device_id: alice.device.id,
               device_token: "test-token",
               user_id: alice.user.id
             })
             |> subscribe_and_join(TopicChannel, "call:#{chat_id}")

    assert {:ok, call} =
             Calls.start_call(chat_id, alice.user.id, alice.device.id, %{
               "mode" => "voice"
             })

    call_id = call.id
    device_id = alice.device.id

    assert {:ok, _payload} =
             Calls.join_call(call_id, alice.user.id, device_id, %{
               "track_kind" => "audio"
             })

    assert_broadcast "call:participant_state", %{
      call_id: ^call_id,
      participants: [
        %{
          call_id: ^call_id,
          device_id: ^device_id,
          status: "joined"
        }
      ],
      room: %{
        backend: "membrane_rtc_engine",
        call_id: ^call_id,
        endpoint_count: endpoint_count,
        forwarded_track_count: forwarded_track_count,
        participant_count: 1
      }
    }

    assert is_integer(endpoint_count)
    assert is_integer(forwarded_track_count)
  end

  test "call topics receive signaling broadcasts for Membrane/WebRTC negotiation" do
    alice = register_identity("alice")
    {:ok, chat} = Messaging.ensure_direct_chat(alice.user.id, alice.user.username)
    chat_id = chat.id

    assert {:ok, %{status: "connected", topic: "call:" <> _chat_id}, _socket} =
             DeviceSocket
             |> socket("device_socket:#{alice.device.id}", %{
               device_id: alice.device.id,
               device_token: "test-token",
               user_id: alice.user.id
             })
             |> subscribe_and_join(TopicChannel, "call:#{chat_id}")

    assert {:ok, call} =
             Calls.start_call(chat_id, alice.user.id, alice.device.id, %{
               "mode" => "video"
             })

    call_id = call.id
    device_id = alice.device.id

    assert {:ok, _payload} =
             Calls.emit_signal(call_id, alice.user.id, device_id, %{
               "signal_type" => "offer",
               "payload" => ~s({"type":"offer","sdp":"stub"})
             })

    assert_broadcast "call:signal", %{
      call_id: ^call_id,
      signal: %{
        call_id: ^call_id,
        from_device_id: ^device_id,
        signal_type: "offer"
      }
    }
  end

  defp register_identity(prefix) do
    suffix = System.unique_integer([:positive])
    username = "#{prefix}#{suffix}"

    assert {:ok, %{device: device, user: user}} =
             Identity.register_device(%{
               "device_identity_public_key" => Base.encode64(:crypto.strong_rand_bytes(32)),
               "device_name" => "Browser #{suffix}",
               "username" => username
             })

    %{device: device, user: user}
  end
end
