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
    post "/federation/deliveries", FederationController, :ingest_delivery
    post "/federation/peers/accept", FederationController, :accept_peer_invite
    post "/register", RegistrationController, :create
    post "/auth/challenge", AuthController, :challenge
    post "/auth/verify", AuthController, :verify
  end

  scope "/api/v1", VostokServerWeb.Api.V1, as: :api_v1 do
    pipe_through :api_authenticated

    post "/devices/link", DeviceController, :link
    get "/devices", DeviceController, :index
    post "/devices/:device_id/revoke", DeviceController, :revoke
    post "/devices/prekeys", PrekeyController, :publish
    get "/users/:username/devices/prekeys", PrekeyController, :show
    get "/me", ChatController, :me
    get "/chats", ChatController, :index
    post "/chats/direct", ChatController, :create_direct
    post "/chats/group", ChatController, :create_group
    patch "/chats/:chat_id/group", ChatController, :update_group
    get "/chats/:chat_id/members", ChatController, :group_members
    patch "/chats/:chat_id/members/:user_id", ChatController, :update_group_member
    post "/chats/:chat_id/members/:user_id/remove", ChatController, :remove_group_member
    get "/chats/:chat_id/sender-keys", ChatController, :list_group_sender_keys
    post "/chats/:chat_id/sender-keys", ChatController, :distribute_group_sender_keys
    post "/chats/:chat_id/session-bootstrap", ChatController, :session_bootstrap
    post "/chats/:chat_id/session-rekey", ChatController, :session_rekey
    get "/chats/:chat_id/safety-numbers", ChatController, :safety_numbers

    post "/chats/:chat_id/safety-numbers/:peer_device_id/verify",
         ChatController,
         :verify_safety_number

    get "/chats/:chat_id/recipient-devices", ChatController, :recipient_devices
    get "/chats/:chat_id/messages", ChatController, :messages
    post "/chats/:chat_id/messages", ChatController, :create_message
    patch "/chats/:chat_id/messages/:message_id", ChatController, :update_message
    post "/chats/:chat_id/messages/:message_id/delete", ChatController, :delete_message
    post "/chats/:chat_id/messages/:message_id/pin", ChatController, :toggle_pin
    post "/chats/:chat_id/messages/:message_id/reactions", ChatController, :toggle_reaction
    post "/media/uploads", MediaController, :create_upload
    get "/media/uploads/:id", MediaController, :upload_status
    patch "/media/uploads/:id/part", MediaController, :upload_part
    post "/media/uploads/:id/complete", MediaController, :complete_upload
    get "/media/:id", MediaController, :show
    post "/media/link-metadata", MediaController, :link_metadata
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

    post "/admin/federation/peers/:peer_id/invite",
         AdminController,
         :create_federation_peer_invite

    get "/chats/:chat_id/calls/active", CallController, :active_call
    post "/chats/:chat_id/calls", CallController, :create_call
    post "/calls/turn-credentials", CallController, :turn_credentials
    get "/calls/:call_id", CallController, :call_state
    post "/calls/:call_id/join", CallController, :join_call
    get "/calls/:call_id/keys", CallController, :call_keys
    post "/calls/:call_id/keys", CallController, :rotate_call_keys
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
