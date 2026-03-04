defmodule VostokServer.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      VostokServerWeb.Telemetry,
      VostokServer.Repo,
      {Oban, Application.fetch_env!(:vostok_server, Oban)},
      VostokServer.Auth.ChallengeStore,
      {Registry, keys: :unique, name: VostokServer.Calls.RoomRegistry},
      VostokServer.Calls.RoomSupervisor,
      {DNSCluster, query: Application.get_env(:vostok_server, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: VostokServer.PubSub},
      # Start a worker by calling: VostokServer.Worker.start_link(arg)
      # {VostokServer.Worker, arg},
      # Start to serve requests, typically the last entry
      VostokServerWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: VostokServer.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    VostokServerWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
