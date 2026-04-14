import Config

# Do not print debug messages in production
config :logger, level: :info

# Structured JSON logging for production
config :logger, :default_formatter,
  format: {VostokServer.Logger.JSONFormatter, :format},
  metadata: [:request_id, :user_id, :device_id, :chat_id, :remote_ip, :duration_ms]

config :vostok_server, VostokServerWeb.Endpoint,
  force_ssl: [rewrite_on: [:x_forwarded_proto], hsts: true]

# Runtime production configuration, including reading
# of environment variables, is done on config/runtime.exs.
