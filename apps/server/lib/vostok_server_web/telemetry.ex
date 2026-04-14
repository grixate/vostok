defmodule VostokServerWeb.Telemetry do
  use Supervisor
  import Telemetry.Metrics

  def start_link(arg) do
    Supervisor.start_link(__MODULE__, arg, name: __MODULE__)
  end

  require Logger

  @impl true
  def init(_arg) do
    # Attach Oban job telemetry for structured logging of background work
    :telemetry.attach(
      "oban-job-stop",
      [:oban, :job, :stop],
      &__MODULE__.handle_oban_event/4,
      nil
    )

    :telemetry.attach(
      "oban-job-exception",
      [:oban, :job, :exception],
      &__MODULE__.handle_oban_event/4,
      nil
    )

    children = [
      {:telemetry_poller, measurements: periodic_measurements(), period: 10_000}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  def handle_oban_event([:oban, :job, :stop], measure, meta, _config) do
    duration_ms = System.convert_time_unit(measure.duration, :native, :millisecond)
    Logger.info("[Oban] #{meta.worker} completed in #{duration_ms}ms (queue: #{meta.queue})")
  end

  def handle_oban_event([:oban, :job, :exception], measure, meta, _config) do
    duration_ms = System.convert_time_unit(measure.duration, :native, :millisecond)

    Logger.error(
      "[Oban] #{meta.worker} FAILED in #{duration_ms}ms (queue: #{meta.queue}, attempt: #{meta.attempt}): #{inspect(meta.reason)}"
    )
  end

  def metrics do
    [
      # Phoenix Metrics
      summary("phoenix.endpoint.start.system_time",
        unit: {:native, :millisecond}
      ),
      summary("phoenix.endpoint.stop.duration",
        unit: {:native, :millisecond}
      ),
      summary("phoenix.router_dispatch.start.system_time",
        tags: [:route],
        unit: {:native, :millisecond}
      ),
      summary("phoenix.router_dispatch.exception.duration",
        tags: [:route],
        unit: {:native, :millisecond}
      ),
      summary("phoenix.router_dispatch.stop.duration",
        tags: [:route],
        unit: {:native, :millisecond}
      ),
      summary("phoenix.socket_connected.duration",
        unit: {:native, :millisecond}
      ),
      sum("phoenix.socket_drain.count"),
      summary("phoenix.channel_joined.duration",
        unit: {:native, :millisecond}
      ),
      summary("phoenix.channel_handled_in.duration",
        tags: [:event],
        unit: {:native, :millisecond}
      ),

      # Database Metrics
      summary("vostok_server.repo.query.total_time",
        unit: {:native, :millisecond},
        description: "The sum of the other measurements"
      ),
      summary("vostok_server.repo.query.decode_time",
        unit: {:native, :millisecond},
        description: "The time spent decoding the data received from the database"
      ),
      summary("vostok_server.repo.query.query_time",
        unit: {:native, :millisecond},
        description: "The time spent executing the query"
      ),
      summary("vostok_server.repo.query.queue_time",
        unit: {:native, :millisecond},
        description: "The time spent waiting for a database connection"
      ),
      summary("vostok_server.repo.query.idle_time",
        unit: {:native, :millisecond},
        description:
          "The time the connection spent waiting before being checked out for the query"
      ),

      # VM Metrics
      summary("vm.memory.total", unit: {:byte, :kilobyte}),
      summary("vm.total_run_queue_lengths.total"),
      summary("vm.total_run_queue_lengths.cpu"),
      summary("vm.total_run_queue_lengths.io")
    ]
  end

  defp periodic_measurements do
    [
      # A module, function and arguments to be invoked periodically.
      # This function must call :telemetry.execute/3 and a metric must be added above.
      # {VostokServerWeb, :count_users, []}
    ]
  end
end
