defmodule VostokServerWeb.Api.V1.BootstrapController do
  use VostokServerWeb, :controller

  def show(conn, _params) do
    json(conn, %{
      api_version: "v1",
      registration_mode: Application.get_env(:vostok_server, :registration_mode, "open"),
      websocket: %{
        path: "/socket/device",
        topics: ["user:{user_id}", "chat:{chat_id}", "presence:{scope}", "call:{chat_id}"]
      },
      features: %{
        auth: "challenge_verify_live",
        identity: "registration_and_device_link_live",
        prekeys: "publish_and_fetch_live",
        messaging: "direct_chat_http_live",
        media: "chunked_upload_live",
        federation: "admin_scaffold_live",
        calls: "turn_credentials_live"
      },
      ui_packages: ["@vostok/ui-tokens", "@vostok/ui-primitives", "@vostok/ui-chat"]
    })
  end
end
