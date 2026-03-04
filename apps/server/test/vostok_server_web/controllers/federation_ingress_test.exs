defmodule VostokServerWeb.FederationIngressTest do
  use VostokServerWeb.ConnCase, async: false

  alias VostokServer.Federation.Peer
  alias VostokServer.Repo

  setup do
    previous_transport = Application.get_env(:vostok_server, :federation_transport)

    Application.put_env(:vostok_server, :federation_transport,
      source_domain: "chat.local.example",
      require_client_cert: false
    )

    on_exit(fn ->
      Application.put_env(:vostok_server, :federation_transport, previous_transport)
    end)

    :ok
  end

  test "ingest_delivery accepts inbound relay payloads", %{conn: conn} do
    peer =
      %Peer{}
      |> Peer.changeset(%{
        domain: "chat.remote.example",
        status: "active",
        display_name: "Remote"
      })
      |> Repo.insert!()

    peer_id = peer.id

    ingest_conn =
      post(conn, "/api/v1/federation/deliveries", %{
        source_domain: peer.domain,
        delivery_id: "remote-delivery-42",
        event_type: "message_relay",
        payload: %{
          envelope_id: "env-42",
          chat_id: "chat-42"
        }
      })

    assert %{
             "delivery" => %{
               "peer_id" => ^peer_id,
               "direction" => "inbound",
               "status" => "delivered",
               "remote_delivery_id" => "remote-delivery-42"
             }
           } = json_response(ingest_conn, 202)
  end
end
