defmodule VostokServerWeb.Router do
  use VostokServerWeb, :router

  scope "/", VostokServerWeb do
    get "/health", HealthController, :show
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :api_authenticated do
    plug :accepts, ["json"]
    plug VostokServerWeb.Plugs.AuthenticatedDevice
  end

  scope "/api/v1", VostokServerWeb.Api.V1, as: :api_v1 do
    pipe_through :api

    get "/health", HealthController, :show
    get "/bootstrap", BootstrapController, :show
    post "/register", RegistrationController, :create
    post "/auth/challenge", AuthController, :challenge
    post "/auth/verify", AuthController, :verify
  end

  scope "/api/v1", VostokServerWeb.Api.V1, as: :api_v1 do
    pipe_through :api_authenticated

    post "/devices/prekeys", PrekeyController, :publish
    get "/users/:username/devices/prekeys", PrekeyController, :show
    get "/me", ChatController, :me
    get "/chats", ChatController, :index
    post "/chats/direct", ChatController, :create_direct
    post "/chats/group", ChatController, :create_group
    post "/chats/:chat_id/session-bootstrap", ChatController, :session_bootstrap
    get "/chats/:chat_id/recipient-devices", ChatController, :recipient_devices
    get "/chats/:chat_id/messages", ChatController, :messages
    post "/chats/:chat_id/messages", ChatController, :create_message
    post "/chats/:chat_id/messages/:message_id/reactions", ChatController, :toggle_reaction
    post "/media/uploads", MediaController, :create_upload
    patch "/media/uploads/:id/part", MediaController, :upload_part
    post "/media/uploads/:id/complete", MediaController, :complete_upload
    get "/media/:id", MediaController, :show
    get "/admin/overview", AdminController, :overview
    get "/admin/federation/peers", AdminController, :federation_peers
    post "/admin/federation/peers", AdminController, :create_federation_peer
    get "/admin/federation/deliveries", AdminController, :federation_deliveries

    post "/admin/federation/peers/:peer_id/deliveries",
         AdminController,
         :create_federation_delivery

    post "/admin/federation/deliveries/:job_id/attempt",
         AdminController,
         :attempt_federation_delivery

    post "/admin/federation/peers/:peer_id/status",
         AdminController,
         :update_federation_peer_status

    post "/admin/federation/peers/:peer_id/heartbeat", AdminController, :federation_peer_heartbeat
    get "/chats/:chat_id/calls/active", CallController, :active_call
    post "/chats/:chat_id/calls", CallController, :create_call
    post "/calls/turn-credentials", CallController, :turn_credentials
    get "/calls/:call_id", CallController, :call_state
    post "/calls/:call_id/join", CallController, :join_call
    post "/calls/:call_id/webrtc-endpoint", CallController, :provision_webrtc_endpoint
    get "/calls/:call_id/webrtc-endpoint", CallController, :webrtc_endpoint_state
    post "/calls/:call_id/webrtc-endpoint/media-events", CallController, :push_webrtc_media_event
    post "/calls/:call_id/webrtc-endpoint/poll", CallController, :poll_webrtc_media_events
    get "/calls/:call_id/signals", CallController, :signals
    post "/calls/:call_id/signals", CallController, :emit_signal
    post "/calls/:call_id/leave", CallController, :leave_call
    post "/calls/:call_id/end", CallController, :end_call
  end
end
