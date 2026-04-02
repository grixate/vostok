defmodule VostokServer.Calls.Mutations do
  @moduledoc false

  import Ecto.Query

  alias VostokServer.Calls.{CallParticipant, CallSignal}
  alias VostokServer.Repo

  def upsert_participant(call, user_id, current_device_id, track_kind, e2ee_attrs, format_error)
      when is_function(format_error, 1) do
    now = DateTime.utc_now()

    case Repo.get_by(CallParticipant, call_id: call.id, device_id: current_device_id) do
      %CallParticipant{} = participant ->
        participant
        |> CallParticipant.changeset(%{
          user_id: user_id,
          status: "joined",
          track_kind: track_kind,
          e2ee_capable: Map.get(e2ee_attrs, :e2ee_capable, false),
          e2ee_algorithm: Map.get(e2ee_attrs, :e2ee_algorithm),
          e2ee_key_epoch: Map.get(e2ee_attrs, :e2ee_key_epoch),
          joined_at: participant.joined_at || now,
          left_at: nil
        })
        |> Repo.update()
        |> normalize_participant_result(format_error)

      nil ->
        %CallParticipant{}
        |> CallParticipant.changeset(%{
          call_id: call.id,
          user_id: user_id,
          device_id: current_device_id,
          status: "joined",
          track_kind: track_kind,
          e2ee_capable: Map.get(e2ee_attrs, :e2ee_capable, false),
          e2ee_algorithm: Map.get(e2ee_attrs, :e2ee_algorithm),
          e2ee_key_epoch: Map.get(e2ee_attrs, :e2ee_key_epoch),
          joined_at: now
        })
        |> Repo.insert()
        |> normalize_participant_result(format_error)
    end
  end

  def mark_participant_left(call_id, current_device_id, format_error)
      when is_function(format_error, 1) do
    case Repo.get_by(CallParticipant, call_id: call_id, device_id: current_device_id) do
      %CallParticipant{} = participant ->
        participant
        |> CallParticipant.changeset(%{
          status: "left",
          left_at: DateTime.utc_now()
        })
        |> Repo.update()
        |> normalize_participant_result(format_error)

      nil ->
        {:error, {:not_found, "Participant is not part of this call."}}
    end
  end

  def mark_all_participants_left(call_id) do
    from(participant in CallParticipant,
      where: participant.call_id == ^call_id and participant.status == "joined"
    )
    |> Repo.update_all(set: [status: "left", left_at: DateTime.utc_now()])
  end

  def insert_signal(signal_attrs, format_error) when is_function(format_error, 1) do
    %CallSignal{}
    |> CallSignal.changeset(signal_attrs)
    |> Repo.insert()
    |> case do
      {:ok, signal} -> {:ok, signal}
      {:error, changeset} -> {:error, {:validation, format_error.(changeset)}}
    end
  end

  defp normalize_participant_result({:ok, participant}, _format_error), do: {:ok, participant}

  defp normalize_participant_result({:error, changeset}, format_error) do
    {:error, {:validation, format_error.(changeset)}}
  end
end
