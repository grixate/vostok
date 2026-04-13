import Config

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere. Do not define
# any compile-time configuration in here, as it won't be applied.
# The block below contains prod specific runtime configuration.

# ## Using releases
#
# If you use `mix release`, you need to explicitly enable the server
# by passing the PHX_SERVER=true when you start it:
#
#     PHX_SERVER=true bin/vostok_server start
#
# Alternatively, you can use `mix phx.gen.release` to generate a `bin/server`
# script that automatically sets the env var above.
if System.get_env("PHX_SERVER") do
  config :vostok_server, VostokServerWeb.Endpoint, server: true
end

env_integer = fn key, default ->
  case System.get_env(key) do
    nil -> default
    "" -> default
    value -> String.to_integer(value)
  end
end

env_boolean = fn key, default ->
  case System.get_env(key) do
    nil ->
      default

    value ->
      normalized = value |> String.trim() |> String.downcase()
      normalized in ["1", "true", "yes", "on"]
  end
end

first_non_loopback_ipv4 = fn ->
  with {:ok, ifaddrs} <- :inet.getifaddrs() do
    ifaddrs
    |> Enum.find_value(fn {_name, attrs} ->
      attrs
      |> Keyword.get_values(:addr)
      |> Enum.find(fn
        {127, _, _, _} -> false
        {169, 254, _, _} -> false
        {198, second, _, _} when second in 18..19 -> false
        {a, b, c, d}
            when is_integer(a) and is_integer(b) and is_integer(c) and is_integer(d) ->
          true
        _other ->
          false
      end)
    end)
  else
    _ -> nil
  end
end

default_turn_host = fn fallback_host ->
  configured_phx_host =
    System.get_env("PHX_HOST")
    |> case do
      nil -> nil
      value -> value |> String.trim()
    end

  cond do
    System.get_env("VOSTOK_TURN_PUBLIC_HOST") not in [nil, ""] ->
      System.get_env("VOSTOK_TURN_PUBLIC_HOST")

    configured_phx_host not in [nil, "", "localhost", "127.0.0.1", "::1"] ->
      configured_phx_host

    inferred_ip = first_non_loopback_ipv4.() ->
      inferred_ip |> Tuple.to_list() |> Enum.join(".")

    true ->
      fallback_host
  end
end

default_turn_uris = fn fallback_host ->
  host = default_turn_host.(fallback_host)

  [
    "turn:#{host}:3478?transport=udp",
    "turn:#{host}:3478?transport=tcp"
  ]
end

if config_env() == :prod do
  database_url =
    System.get_env("DATABASE_URL") ||
      raise """
      environment variable DATABASE_URL is missing.
      For example: ecto://USER:PASS@HOST/DATABASE
      """

  maybe_ipv6 = if System.get_env("ECTO_IPV6") in ~w(true 1), do: [:inet6], else: []

  config :vostok_server, VostokServer.Repo,
    # ssl: true,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
    # For machines with several cores, consider starting multiple pools of `pool_size`
    # pool_count: 4,
    socket_options: maybe_ipv6

  # The secret key base is used to sign/encrypt cookies and other secrets.
  # A default value is used in config/dev.exs and config/test.exs but you
  # want to use a different value for prod and you most likely don't want
  # to check this value into version control, so we use an environment
  # variable instead.
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  host = System.get_env("PHX_HOST") || "example.com"
  port = String.to_integer(System.get_env("PORT") || "4000")

  config :vostok_server, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")

  prod_auth_mode =
    System.get_env("VOSTOK_AUTH_MODE") ||
      System.get_env("VOSTOK_REGISTRATION_MODE", "invite_only")

  config :vostok_server,
    auth_mode: prod_auth_mode,
    registration_mode: prod_auth_mode,
    server_name: System.get_env("VOSTOK_SERVER_NAME", "Vostok"),
    federation_port: env_integer.("VOSTOK_FEDERATION_PORT", 5555),
    federation_domain: System.get_env("VOSTOK_FEDERATION_DOMAIN", host),
    federation_transport: [
      scheme: System.get_env("VOSTOK_FEDERATION_SCHEME", "https"),
      wire_format: System.get_env("VOSTOK_FEDERATION_WIRE_FORMAT", "protobuf"),
      delivery_path:
        System.get_env("VOSTOK_FEDERATION_DELIVERY_PATH", "/api/v1/federation/deliveries"),
      connect_timeout_ms: env_integer.("VOSTOK_FEDERATION_CONNECT_TIMEOUT_MS", 5_000),
      request_timeout_ms: env_integer.("VOSTOK_FEDERATION_REQUEST_TIMEOUT_MS", 10_000),
      retry_backoff_seconds: env_integer.("VOSTOK_FEDERATION_RETRY_BACKOFF_SECONDS", 30),
      retry_backoff_cap_seconds: env_integer.("VOSTOK_FEDERATION_RETRY_BACKOFF_CAP_SECONDS", 900),
      signing_secret: System.get_env("VOSTOK_FEDERATION_SIGNING_SECRET"),
      allow_insecure_http: env_boolean.("VOSTOK_FEDERATION_ALLOW_INSECURE_HTTP", false),
      require_client_cert: env_boolean.("VOSTOK_FEDERATION_REQUIRE_CLIENT_CERT", true),
      mtls: [
        certfile: System.get_env("VOSTOK_FEDERATION_MTLS_CERTFILE"),
        keyfile: System.get_env("VOSTOK_FEDERATION_MTLS_KEYFILE"),
        cacertfile: System.get_env("VOSTOK_FEDERATION_MTLS_CACERTFILE"),
        server_name_indication: System.get_env("VOSTOK_FEDERATION_MTLS_SNI")
      ]
    ]

  turn_uris =
    case System.get_env("VOSTOK_TURN_URIS") do
      nil -> default_turn_uris.(host)
      val -> val |> String.split(",") |> Enum.map(&String.trim/1)
    end

  config :vostok_server,
    turn_shared_secret: System.get_env("VOSTOK_TURN_SHARED_SECRET", "vostok-dev-turn-secret"),
    public_turn_uris: turn_uris,
    turn_ports_range_start: env_integer.("VOSTOK_TURN_PORT_RANGE_START", 50_000),
    turn_ports_range_end: env_integer.("VOSTOK_TURN_PORT_RANGE_END", 50_050),
    call_media_event_queue_limit: env_integer.("VOSTOK_CALL_MEDIA_EVENT_QUEUE_LIMIT", 64),
    call_simulcast_enabled: env_boolean.("VOSTOK_CALL_SIMULCAST_ENABLED", true),
    call_video_tracks_limit: env_integer.("VOSTOK_CALL_VIDEO_TRACKS_LIMIT", 8),
    call_webrtc_toilet_capacity: env_integer.("VOSTOK_CALL_WEBRTC_TOILET_CAPACITY", 320)

  config :vostok_server, VostokServerWeb.Endpoint,
    url: [host: host, port: 443, scheme: System.get_env("PHX_SCHEME", "https")],
    http: [
      # Enable IPv6 and bind on all interfaces.
      # Set it to  {0, 0, 0, 0, 0, 0, 0, 1} for local network only access.
      # See the documentation on https://hexdocs.pm/bandit/Bandit.html#t:options/0
      # for details about using IPv6 vs IPv4 and loopback vs public addresses.
      ip: {0, 0, 0, 0, 0, 0, 0, 0},
      port: port
    ],
    secret_key_base: secret_key_base

  # ## SSL Support
  #
  # To get SSL working, you will need to add the `https` key
  # to your endpoint configuration:
  #
  #     config :vostok_server, VostokServerWeb.Endpoint,
  #       https: [
  #         ...,
  #         port: 443,
  #         cipher_suite: :strong,
  #         keyfile: System.get_env("SOME_APP_SSL_KEY_PATH"),
  #         certfile: System.get_env("SOME_APP_SSL_CERT_PATH")
  #       ]
  #
  # The `cipher_suite` is set to `:strong` to support only the
  # latest and more secure SSL ciphers. This means old browsers
  # and clients may not be supported. You can set it to
  # `:compatible` for wider support.
  #
  # `:keyfile` and `:certfile` expect an absolute path to the key
  # and cert in disk or a relative path inside priv, for example
  # "priv/ssl/server.key". For all supported SSL configuration
  # options, see https://hexdocs.pm/plug/Plug.SSL.html#configure/1
  #
  # We also recommend setting `force_ssl` in your config/prod.exs,
  # ensuring no data is ever sent via http, always redirecting to https:
  #
  #     config :vostok_server, VostokServerWeb.Endpoint,
  #       force_ssl: [hsts: true]
  #
  # Check `Plug.SSL` for all available options in `force_ssl`.
end

# ── Media Storage ────────────────────────────────────────────────────────
config :vostok_server, VostokServer.Storage,
  hot_cache_dir: System.get_env("VOSTOK_MEDIA_DIR", "priv/media/hot"),
  hot_cache_max_bytes: env_integer.("VOSTOK_MEDIA_MAX_BYTES", 50_000_000_000),
  eviction_interval_ms: env_integer.("VOSTOK_EVICTION_INTERVAL_MS", 900_000),
  eviction_batch_size: env_integer.("VOSTOK_EVICTION_BATCH_SIZE", 100),
  max_age_days: env_integer.("VOSTOK_MEDIA_MAX_AGE_DAYS", 30),
  delivery_grace_period_hours: env_integer.("VOSTOK_MEDIA_GRACE_HOURS", 48),
  object_store: [
    enabled: env_boolean.("VOSTOK_S3_ENABLED", false),
    adapter: VostokServer.Storage.ObjectStore.S3,
    bucket: System.get_env("VOSTOK_S3_BUCKET", "vostok-media"),
    region: System.get_env("VOSTOK_S3_REGION", "us-east-1"),
    endpoint: System.get_env("VOSTOK_S3_ENDPOINT"),
    access_key_id: {:system, "VOSTOK_S3_ACCESS_KEY"},
    secret_access_key: {:system, "VOSTOK_S3_SECRET_KEY"},
    presigned_urls: env_boolean.("VOSTOK_S3_PRESIGNED_URLS", true),
    presigned_url_ttl_seconds: env_integer.("VOSTOK_S3_PRESIGNED_TTL", 300)
  ]

if config_env() in [:dev, :test] do
  host = System.get_env("PHX_HOST", "localhost")

  auth_mode =
    System.get_env("VOSTOK_AUTH_MODE") ||
      System.get_env("VOSTOK_REGISTRATION_MODE", "invite_only")

  message_ttl_hours =
    case System.get_env("VOSTOK_MESSAGE_TTL_HOURS") do
      nil -> 720
      val -> String.to_integer(val)
    end

  config :vostok_server,
    auth_mode: auth_mode,
    registration_mode: auth_mode,
    message_ttl_hours: message_ttl_hours,
    vapid_public_key: System.get_env("VOSTOK_VAPID_PUBLIC_KEY"),
    vapid_private_key: System.get_env("VOSTOK_VAPID_PRIVATE_KEY"),
    vapid_subject: System.get_env("VOSTOK_VAPID_SUBJECT", "mailto:admin@localhost"),
    server_name: System.get_env("VOSTOK_SERVER_NAME", "Vostok"),
    federation_port: env_integer.("VOSTOK_FEDERATION_PORT", 5555),
    federation_domain: System.get_env("VOSTOK_FEDERATION_DOMAIN", host),
    federation_transport: [
      scheme: System.get_env("VOSTOK_FEDERATION_SCHEME", "https"),
      wire_format: System.get_env("VOSTOK_FEDERATION_WIRE_FORMAT", "protobuf"),
      delivery_path:
        System.get_env("VOSTOK_FEDERATION_DELIVERY_PATH", "/api/v1/federation/deliveries"),
      connect_timeout_ms: env_integer.("VOSTOK_FEDERATION_CONNECT_TIMEOUT_MS", 5_000),
      request_timeout_ms: env_integer.("VOSTOK_FEDERATION_REQUEST_TIMEOUT_MS", 10_000),
      retry_backoff_seconds: env_integer.("VOSTOK_FEDERATION_RETRY_BACKOFF_SECONDS", 30),
      retry_backoff_cap_seconds: env_integer.("VOSTOK_FEDERATION_RETRY_BACKOFF_CAP_SECONDS", 900),
      signing_secret: System.get_env("VOSTOK_FEDERATION_SIGNING_SECRET"),
      allow_insecure_http: env_boolean.("VOSTOK_FEDERATION_ALLOW_INSECURE_HTTP", false),
      require_client_cert: env_boolean.("VOSTOK_FEDERATION_REQUIRE_CLIENT_CERT", false),
      mtls: [
        certfile: System.get_env("VOSTOK_FEDERATION_MTLS_CERTFILE"),
        keyfile: System.get_env("VOSTOK_FEDERATION_MTLS_KEYFILE"),
        cacertfile: System.get_env("VOSTOK_FEDERATION_MTLS_CACERTFILE"),
        server_name_indication: System.get_env("VOSTOK_FEDERATION_MTLS_SNI")
      ]
    ]

  dev_turn_uris =
    case System.get_env("VOSTOK_TURN_URIS") do
      nil -> default_turn_uris.(host)
      val -> val |> String.split(",") |> Enum.map(&String.trim/1)
    end

  config :vostok_server,
    turn_shared_secret: System.get_env("VOSTOK_TURN_SHARED_SECRET", "vostok-dev-turn-secret"),
    public_turn_uris: dev_turn_uris,
    turn_ports_range_start: env_integer.("VOSTOK_TURN_PORT_RANGE_START", 50_000),
    turn_ports_range_end: env_integer.("VOSTOK_TURN_PORT_RANGE_END", 50_050),
    call_media_event_queue_limit: env_integer.("VOSTOK_CALL_MEDIA_EVENT_QUEUE_LIMIT", 64),
    call_simulcast_enabled: env_boolean.("VOSTOK_CALL_SIMULCAST_ENABLED", true),
    call_video_tracks_limit: env_integer.("VOSTOK_CALL_VIDEO_TRACKS_LIMIT", 8),
    call_webrtc_toilet_capacity: env_integer.("VOSTOK_CALL_WEBRTC_TOILET_CAPACITY", 320)
end
