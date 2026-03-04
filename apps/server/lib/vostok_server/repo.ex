defmodule VostokServer.Repo do
  use Ecto.Repo,
    otp_app: :vostok_server,
    adapter: Ecto.Adapters.Postgres
end
