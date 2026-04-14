defmodule VostokServer.Logger.JSONFormatter do
  @moduledoc """
  Structured JSON log formatter for production.

  Outputs one JSON object per line with fields:
  - time, level, msg — always present
  - request_id, user_id, device_id, chat_id, remote_ip — when available
  - Additional metadata merged at top level
  """

  def format(level, message, timestamp, metadata) do
    {date, {hour, min, sec, _ms}} = timestamp

    base = %{
      "time" => format_timestamp(date, {hour, min, sec}),
      "level" => Atom.to_string(level),
      "msg" => IO.chardata_to_string(message)
    }

    meta =
      metadata
      |> Enum.reduce(%{}, fn
        {key, value}, acc when key in [:request_id, :user_id, :device_id, :chat_id] ->
          Map.put(acc, Atom.to_string(key), to_string(value))

        {:remote_ip, {a, b, c, d}}, acc ->
          Map.put(acc, "remote_ip", "#{a}.#{b}.#{c}.#{d}")

        {:remote_ip, value}, acc when is_binary(value) ->
          Map.put(acc, "remote_ip", value)

        {:duration_ms, value}, acc when is_number(value) ->
          Map.put(acc, "duration_ms", value)

        _other, acc ->
          acc
      end)

    [Jason.encode_to_iodata!(Map.merge(base, meta)), ?\n]
  rescue
    _ -> ["#{timestamp} [#{level}] #{message}\n"]
  end

  defp format_timestamp({year, month, day}, {hour, min, sec}) do
    :io_lib.format("~4..0B-~2..0B-~2..0BT~2..0B:~2..0B:~2..0BZ", [
      year, month, day, hour, min, sec
    ])
    |> IO.iodata_to_binary()
  end
end
