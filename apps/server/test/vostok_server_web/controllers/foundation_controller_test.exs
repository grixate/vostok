defmodule VostokServerWeb.FoundationControllerTest do
  use ExUnit.Case, async: true

  import Phoenix.ConnTest

  @endpoint VostokServerWeb.Endpoint

  test "GET /health returns service metadata" do
    conn = build_conn() |> get("/health")

    assert %{
             "status" => "ok",
             "service" => "vostok-server",
             "timestamp" => timestamp
           } = json_response(conn, 200)

    assert String.contains?(timestamp, "T")
  end

  test "GET /api/v1/health returns api metadata" do
    conn = build_conn() |> get("/api/v1/health")

    assert %{
             "status" => "ok",
             "api_version" => "v1",
             "timestamp" => timestamp
           } = json_response(conn, 200)

    assert String.contains?(timestamp, "T")
  end

  test "GET /api/v1/bootstrap returns current transport contracts" do
    conn = build_conn() |> get("/api/v1/bootstrap")

    assert %{
             "api_version" => "v1",
             "features" => features,
             "registration_mode" => registration_mode,
             "ui_packages" => ui_packages,
             "websocket" => %{
               "path" => "/socket/device",
               "topics" => topics
             }
           } = json_response(conn, 200)

    assert features["auth"] == "challenge_verify_live"
    assert is_binary(registration_mode)
    assert "@vostok/ui-chat" in ui_packages
    assert "chat:{chat_id}" in topics
  end
end
