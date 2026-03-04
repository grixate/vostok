# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :vostok_server,
  ecto_repos: [VostokServer.Repo],
  generators: [timestamp_type: :utc_datetime, binary_id: true]

config :vostok_server, Oban,
  repo: VostokServer.Repo,
  queues: [default: 10],
  plugins: []

# Configures the endpoint
config :vostok_server, VostokServerWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: VostokServerWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: VostokServer.PubSub,
  live_view: [signing_salt: "34D8iAc+"]

# Configures Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
