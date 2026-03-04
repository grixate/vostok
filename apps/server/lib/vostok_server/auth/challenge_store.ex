defmodule VostokServer.Auth.ChallengeStore do
  @moduledoc """
  Short-lived in-memory challenge store for Ed25519 device authentication.
  """

  use GenServer

  @table :vostok_auth_challenges
  @ttl_seconds 300

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  def issue(device_id) when is_binary(device_id) do
    GenServer.call(__MODULE__, {:issue, device_id})
  end

  def take_for_device(challenge_id, device_id)
      when is_binary(challenge_id) and is_binary(device_id) do
    GenServer.call(__MODULE__, {:take_for_device, challenge_id, device_id})
  end

  @impl true
  def init(_state) do
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    {:ok, %{}}
  end

  @impl true
  def handle_call({:issue, device_id}, _from, state) do
    prune_expired()

    challenge_id = Ecto.UUID.generate()
    challenge = :crypto.strong_rand_bytes(32)
    expires_at = DateTime.add(DateTime.utc_now(), @ttl_seconds, :second)

    true = :ets.insert(@table, {challenge_id, device_id, challenge, expires_at})

    {:reply, {:ok, %{challenge_id: challenge_id, challenge: challenge, expires_at: expires_at}},
     state}
  end

  def handle_call({:take_for_device, challenge_id, device_id}, _from, state) do
    prune_expired()

    reply =
      case :ets.take(@table, challenge_id) do
        [{^challenge_id, ^device_id, challenge, expires_at}] ->
          {:ok, %{challenge: challenge, expires_at: expires_at}}

        [{^challenge_id, _other_device_id, _challenge, _expires_at}] ->
          {:error, :device_mismatch}

        [] ->
          {:error, :not_found}
      end

    {:reply, reply, state}
  end

  defp prune_expired do
    now = DateTime.utc_now()

    @table
    |> :ets.tab2list()
    |> Enum.each(fn {challenge_id, _device_id, _challenge, expires_at} ->
      if DateTime.compare(expires_at, now) in [:lt, :eq] do
        :ets.delete(@table, challenge_id)
      end
    end)
  end
end
