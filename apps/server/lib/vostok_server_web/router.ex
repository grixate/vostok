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
    plug VostokServerWeb.Plugs.Authenticate
    plug VostokServerWeb.Plugs.RequestContext
  end

  pipeline :api_admin do
    plug VostokServerWeb.Plugs.RequireAdmin
  end

  pipeline :api_dev_only do
    plug VostokServerWeb.Plugs.RequireDevMode
  end

  # ── Public (unauthenticated) endpoints ──────────────────────────────────
  scope "/api/v1", VostokServerWeb.Api.V1, as: :api_v1 do
    pipe_through :api

    get "/health", HealthController, :show
    get "/bootstrap", BootstrapController, :show
    get "/server/info", ServerController, :info

    # Password-based auth
    post "/auth/login", AuthController, :login
    post "/auth/refresh", AuthController, :refresh
    post "/auth/register", RegistrationController, :create
    post "/auth/bootstrap", RegistrationController, :bootstrap
    get "/auth/check-username/:username", AuthController, :check_username
    get "/invites/:code/validate", AuthController, :validate_invite
    post "/auth/access-request", AuthController, :access_request
    post "/auth/password-reset-request", AuthController, :password_reset_request

    # Device challenge-response (for E2E encryption setup)
    post "/auth/challenge", AuthController, :challenge
    post "/auth/verify", AuthController, :verify

    # Legacy device registration (still needed for E2E)
    post "/register", RegistrationController, :create_device

    # Public profile photos (no auth required — photos are public by nature)
    get "/users/:user_id/photo", ChatController, :serve_user_photo

    # Federation
    post "/federation/deliveries", FederationController, :ingest_delivery
    post "/federation/peers/accept", FederationController, :accept_peer_invite
  end

  # ── Dev-only endpoints ──────────────────────────────────────────────────
  scope "/api/v1/dev", VostokServerWeb.Api.V1, as: :api_v1_dev do
    pipe_through [:api, :api_dev_only]

    post "/quick-login", DevController, :quick_login
    post "/users/bulk", DevController, :bulk_create
  end

  # ── Authenticated endpoints ─────────────────────────────────────────────
  scope "/api/v1", VostokServerWeb.Api.V1, as: :api_v1 do
    pipe_through :api_authenticated

    # Auth (requires login)
    post "/auth/logout", AuthController, :logout
    post "/auth/change-password", AuthController, :change_password

    # Device management
    post "/devices/link", DeviceController, :link
    get "/devices", DeviceController, :index
    post "/devices/:device_id/revoke", DeviceController, :revoke
    post "/devices/push-token", DeviceController, :push_token
    post "/devices/prekeys", PrekeyController, :publish

    # Users
    get "/users", UserController, :index
    get "/users/:username/devices/prekeys", PrekeyController, :show
    get "/me", ChatController, :me
    get "/me/storage", ServerController, :my_storage
    patch "/me/profile", ChatController, :update_profile
    post "/me/profile/photo", ChatController, :upload_profile_photo
    get "/me/profile/photo", ChatController, :serve_profile_photo
    delete "/me/profile/photo", ChatController, :delete_profile_photo
    get "/me/settings", ChatController, :get_settings
    put "/me/settings", ChatController, :update_settings

    # Chats
    get "/chats", ChatController, :index
    post "/chats/direct", ChatController, :create_direct
    post "/chats/self", ChatController, :create_self
    post "/chats/group", ChatController, :create_group
    post "/chats/channel", ChatController, :create_channel
    get "/channels", ChatController, :list_public_channels
    patch "/chats/:chat_id/group", ChatController, :update_group
    patch "/chats/:chat_id/info", ChatController, :update_chat_info
    get "/chats/:chat_id/avatar", ChatController, :serve_chat_avatar
    get "/chats/:chat_id/members", ChatController, :group_members
    post "/chats/:chat_id/members", ChatController, :add_chat_members
    patch "/chats/:chat_id/members/:user_id", ChatController, :update_group_member
    post "/chats/:chat_id/members/:user_id/remove", ChatController, :remove_group_member
    post "/chats/:chat_id/leave", ChatController, :leave_chat
    delete "/chats/:chat_id", ChatController, :delete_chat
    post "/chats/:chat_id/transfer-ownership/:user_id", ChatController, :transfer_ownership
    post "/chats/:chat_id/join", ChatController, :join_channel
    post "/chats/:chat_id/invite-links", ChatController, :create_invite_link
    get "/chats/:chat_id/invite-links", ChatController, :list_invite_links
    delete "/chats/:chat_id/invite-links/:id", ChatController, :revoke_invite_link
    post "/invite-links/:code/join", ChatController, :join_via_invite_link
    get "/chats/:chat_id/sender-keys", ChatController, :list_group_sender_keys
    post "/chats/:chat_id/sender-keys", ChatController, :distribute_group_sender_keys
    post "/chats/:chat_id/session-bootstrap", ChatController, :session_bootstrap
    post "/chats/:chat_id/session-rekey", ChatController, :session_rekey
    get "/chats/:chat_id/safety-numbers", ChatController, :safety_numbers
    post "/chats/:chat_id/safety-numbers/:peer_device_id/verify", ChatController, :verify_safety_number
    get "/chats/:chat_id/recipient-devices", ChatController, :recipient_devices
    get "/chats/:chat_id/messages", ChatController, :messages
    post "/chats/:chat_id/read", ChatController, :mark_read
    post "/chats/:chat_id/messages", ChatController, :create_message
    post "/chats/:chat_id/messages/:message_id/view", ChatController, :record_view
    patch "/chats/:chat_id/messages/:message_id", ChatController, :update_message
    post "/chats/:chat_id/messages/:message_id/delete", ChatController, :delete_message
    post "/chats/:chat_id/messages/:message_id/pin", ChatController, :toggle_pin
    post "/chats/:chat_id/messages/:message_id/reactions", ChatController, :toggle_reaction

    # Server
    get "/server/storage", ServerController, :storage_usage

    # Media
    post "/media/uploads", MediaController, :create_upload
    get "/media/uploads/:id", MediaController, :upload_status
    patch "/media/uploads/:id/part", MediaController, :upload_part
    post "/media/uploads/:id/complete", MediaController, :complete_upload
    get "/media/:id", MediaController, :show
    post "/media/:id/confirm", MediaController, :confirm_delivery
    post "/media/link-metadata", MediaController, :link_metadata

    # Key backup
    put "/keys/backup", KeyBackupController, :upload
    get "/keys/backup", KeyBackupController, :download
    delete "/keys/backup", KeyBackupController, :delete

    # Calls
    get "/calls/history", CallController, :call_history
    get "/calls/active", CallController, :active_calls
    get "/chats/:chat_id/calls/active", CallController, :active_call
    post "/chats/:chat_id/calls", CallController, :create_call
    post "/call-rooms", CallRoomController, :create
    get "/call-rooms/:room_id", CallRoomController, :show
    get "/call-rooms/:room_id/recipient-devices", CallRoomController, :recipient_devices
    get "/call-rooms/:room_id/calls/active", CallRoomController, :active_call
    post "/call-rooms/:room_id/calls", CallRoomController, :create_call
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
    post "/calls/:call_id/accept", CallController, :accept_call
    post "/calls/:call_id/decline", CallController, :decline_call
    post "/calls/:call_id/leave", CallController, :leave_call
    post "/calls/:call_id/end", CallController, :end_call

  end

  # ── Admin-only endpoints ────────────────────────────────────────────────
  scope "/api/v1/admin", VostokServerWeb.Api.V1, as: :api_v1_admin do
    pipe_through [:api_authenticated, :api_admin]

    # Invite management
    get "/invites", AdminController, :list_invites
    post "/invites", AdminController, :create_invite
    post "/invites/:id/revoke", AdminController, :revoke_invite

    # Access request management
    get "/access-requests", AdminController, :list_access_requests
    post "/access-requests/:id/approve", AdminController, :approve_access_request
    post "/access-requests/:id/deny", AdminController, :deny_access_request

    # Password reset management
    get "/password-resets", AdminController, :list_password_resets
    post "/password-resets/:id/approve", AdminController, :approve_password_reset
    post "/password-resets/:id/deny", AdminController, :deny_password_reset

    # User management
    get "/users", AdminController, :list_users
    post "/users/:id/disable", AdminController, :disable_user
    post "/users/:id/enable", AdminController, :enable_user
    post "/users/:id/reset-password", AdminController, :reset_user_password
    post "/users/:id/promote", AdminController, :promote_user
    post "/users/:id/demote", AdminController, :demote_user
    delete "/users/:id", AdminController, :delete_user

    # Server settings
    get "/settings", AdminController, :get_settings
    patch "/settings", AdminController, :update_settings

    # Federation operations
    get "/overview", AdminController, :overview
    get "/federation/peers", AdminController, :federation_peers
    post "/federation/peers", AdminController, :create_federation_peer
    get "/federation/deliveries", AdminController, :federation_deliveries
    post "/federation/peers/:peer_id/deliveries", AdminController, :create_federation_delivery
    post "/federation/deliveries/:job_id/attempt", AdminController, :attempt_federation_delivery
    post "/federation/peers/:peer_id/status", AdminController, :update_federation_peer_status
    post "/federation/peers/:peer_id/heartbeat", AdminController, :federation_peer_heartbeat
    post "/federation/peers/:peer_id/invite", AdminController, :create_federation_peer_invite

    # Storage management
    get "/storage/status", StorageAdminController, :status
    get "/storage/usage-by-user", StorageAdminController, :usage_by_user
    get "/storage/policies", StorageAdminController, :list_policies
    put "/storage/policies", StorageAdminController, :update_policy
    post "/storage/evict", StorageAdminController, :trigger_eviction
    post "/storage/object-store/test", StorageAdminController, :test_object_store
    put "/storage/profile", StorageAdminController, :update_profile
  end
end
