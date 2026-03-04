defmodule VostokServer.FederationTest do
  use VostokServer.DataCase, async: false

  alias VostokServer.Federation
  alias VostokServer.Federation.DeliveryWorker
  alias VostokServer.Federation.Peer

  setup do
    previous_adapter = Application.get_env(:vostok_server, :federation_transport_adapter)
    previous_transport = Application.get_env(:vostok_server, :federation_transport)

    Application.put_env(
      :vostok_server,
      :federation_transport_adapter,
      VostokServer.FederationTransportStub
    )

    Application.put_env(:vostok_server, :federation_transport,
      notify_pid: self(),
      source_domain: "chat.local.example",
      retry_backoff_seconds: 2,
      retry_backoff_cap_seconds: 60,
      require_client_cert: false
    )

    on_exit(fn ->
      Application.put_env(:vostok_server, :federation_transport_adapter, previous_adapter)
      Application.put_env(:vostok_server, :federation_transport, previous_transport)
    end)

    :ok
  end

  test "dispatch_delivery relays outbound queue jobs through the transport adapter" do
    peer = create_peer!("chat.remote.example")
    peer_id = peer.id
    delivery_id = queue_delivery!(peer.id)

    assert {:ok, delivery} = Federation.dispatch_delivery(delivery_id)
    assert delivery.status == "delivered"
    assert delivery.attempt_count == 1
    assert delivery.direction == "outbound"

    assert_received {:federation_transport_attempt, ^peer_id, ^delivery_id, "message_relay"}
  end

  test "worker snoozes retryable transport failures" do
    peer = create_peer!("chat.retry.example")
    peer_id = peer.id
    delivery_id = queue_delivery!(peer.id)

    Application.put_env(:vostok_server, :federation_transport,
      notify_pid: self(),
      source_domain: "chat.local.example",
      retry_backoff_seconds: 2,
      retry_backoff_cap_seconds: 60,
      require_client_cert: false,
      stub_outcome: :retryable_error
    )

    assert {:snooze, retry_seconds} =
             DeliveryWorker.perform(%Oban.Job{args: %{"delivery_job_id" => delivery_id}})

    assert retry_seconds >= 1
    assert_received {:federation_transport_attempt, ^peer_id, ^delivery_id, "message_relay"}

    assert {:ok, delivery} = Federation.attempt_delivery(delivery_id, %{"outcome" => "delivered"})
    assert delivery.attempt_count >= 2
  end

  test "receive_delivery persists inbound jobs and deduplicates remote delivery id" do
    peer = create_peer!("chat.inbound.example")

    payload = %{
      "delivery_id" => "remote-delivery-1",
      "source_domain" => peer.domain,
      "event_type" => "message_relay",
      "payload" => %{"envelope_id" => "env-remote-1"}
    }

    assert {:ok, first_delivery} = Federation.receive_delivery(payload)
    assert first_delivery.direction == "inbound"
    assert first_delivery.status == "delivered"
    assert first_delivery.remote_delivery_id == "remote-delivery-1"
    assert first_delivery.attempt_count == 1

    assert {:ok, second_delivery} = Federation.receive_delivery(payload)
    assert second_delivery.id == first_delivery.id
  end

  defp create_peer!(domain) do
    %Peer{}
    |> Peer.changeset(%{domain: domain, status: "active", display_name: "Remote"})
    |> Repo.insert!()
  end

  defp queue_delivery!(peer_id) do
    {:ok, queued_delivery} =
      Federation.queue_delivery(peer_id, %{
        "event_type" => "message_relay",
        "payload" => %{"chat_id" => "chat-1", "envelope_id" => "env-1"}
      })

    queued_delivery.id
  end
end
