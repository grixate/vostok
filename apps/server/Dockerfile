FROM hexpm/elixir:1.19.5-erlang-28.2.1-alpine-3.22

RUN apk add --no-cache build-base git postgresql-client

WORKDIR /app

COPY mix.exs mix.lock* ./
COPY config ./config
RUN mix local.hex --force && mix local.rebar --force && mix deps.get

COPY lib ./lib
COPY priv ./priv

ENV MIX_ENV=dev
ENV PORT=4000

EXPOSE 4000

CMD ["mix", "phx.server"]

