defmodule VostokServer.Calls.Presenter do
  @moduledoc false

  import Ecto.Query

  alias VostokServer.Calls.{
    CallKeyDistribution,
    CallParticipant,
    CallRoom,
    CallRoomMember,
    CallSession,
    CallSignal,
    MembraneRoom
  }

  alias VostokServer.Identity.User
  alias VostokServer.Messaging.ChatMember
  alias VostokServer.Repo

  def present_call(nil), do: nil

  def present_call(%CallSession{} = call) do
    %{
      id: call.id,
      chat_id: call.chat_id,
      call_room_id: call.call_room_id,
      scope_type: call.scope_type,
      scope_id: call.scope_id,
      started_by_device_id: call.started_by_device_id,
      mode: call.mode,
      media_mode: call.media_mode,
      status: call.status,
      end_reason: call.end_reason,
      started_at: iso_or_nil(call.started_at),
      ended_at: iso_or_nil(call.ended_at),
      display_title: nil
    }
  end

  def present_call_room(nil), do: nil

  def present_call_room(%CallRoom{} = room) do
    %{
      id: room.id,
      title: room.title,
      created_by_user_id: room.created_by_user_id,
      expires_at: iso_or_nil(room.expires_at),
      closed_at: iso_or_nil(room.closed_at)
    }
  end

  def present_participant(%CallParticipant{} = participant) do
    %{
      id: participant.id,
      call_id: participant.call_id,
      user_id: participant.user_id,
      username: nil,
      display_name: nil,
      device_id: participant.device_id,
      status: participant.status,
      track_kind: participant.track_kind,
      e2ee_capable: participant.e2ee_capable,
      e2ee_algorithm: participant.e2ee_algorithm,
      e2ee_key_epoch: participant.e2ee_key_epoch,
      joined_at: iso_or_nil(participant.joined_at),
      left_at: iso_or_nil(participant.left_at)
    }
  end

  def present_signal(%CallSignal{} = signal) do
    %{
      id: signal.id,
      call_id: signal.call_id,
      from_device_id: signal.from_device_id,
      target_device_id: signal.target_device_id,
      signal_type: signal.signal_type,
      payload: signal.payload,
      inserted_at: iso_or_nil(signal.inserted_at)
    }
  end

  def present_call_key_distribution(%CallKeyDistribution{} = distribution) do
    %{
      id: distribution.id,
      call_id: distribution.call_id,
      owner_device_id: distribution.owner_device_id,
      recipient_device_id: distribution.recipient_device_id,
      key_epoch: distribution.key_epoch,
      algorithm: distribution.algorithm,
      status: distribution.status,
      wrapped_key: Base.encode64(distribution.wrapped_key),
      inserted_at: iso_or_nil(distribution.inserted_at),
      updated_at: iso_or_nil(distribution.updated_at)
    }
  end

  def call_display_title(%CallSession{scope_type: "call_room"} = call, _user_id) do
    room =
      call.call_room ||
        if(call.call_room_id, do: Repo.get(CallRoom, call.call_room_id), else: nil)

    case room do
      %CallRoom{title: title} when is_binary(title) and title != "" -> String.trim(title)
      _ -> "Group call"
    end
  end

  def call_display_title(%CallSession{} = call, user_id) do
    members =
      from(m in ChatMember, where: m.chat_id == ^call.chat_id and m.user_id != ^user_id)
      |> Repo.all()

    case members do
      [] ->
        "Saved Messages"

      [member] ->
        case Repo.get(User, member.user_id) do
          nil -> "Unknown"
          user -> user.display_name || user.username
        end

      _multiple ->
        case call.chat do
          %{metadata_encrypted: title} when is_binary(title) -> String.trim(title)
          _ -> "Group call"
        end
    end
  end

  def call_participant_preview(%CallSession{scope_type: "call_room"} = call, user_id) do
    from(member in CallRoomMember,
      where:
        member.call_room_id == ^call.call_room_id and member.user_id != ^user_id and
          is_nil(member.left_at),
      join: user in User,
      on: user.id == member.user_id,
      order_by: [asc: user.username],
      limit: 4,
      select: %{
        user_id: user.id,
        username: user.username,
        display_name: user.display_name
      }
    )
    |> Repo.all()
  end

  def call_participant_preview(%CallSession{}, _user_id), do: []

  def call_participant_count(%CallSession{scope_type: "call_room"} = call) do
    from(member in CallRoomMember,
      where: member.call_room_id == ^call.call_room_id and is_nil(member.left_at),
      select: count(member.id)
    )
    |> Repo.one()
  end

  def call_participant_count(%CallSession{} = call) when is_binary(call.chat_id) do
    from(member in ChatMember, where: member.chat_id == ^call.chat_id, select: count(member.id))
    |> Repo.one()
  end

  def present_call_room_for_call(%CallSession{scope_type: "call_room"} = call) do
    (call.call_room ||
       if(call.call_room_id, do: Repo.get(CallRoom, call.call_room_id), else: nil))
    |> present_call_room()
  end

  def present_call_room_for_call(%CallSession{}), do: nil

  def list_presented_participants(call_id) do
    from(participant in CallParticipant,
      where: participant.call_id == ^call_id,
      join: user in User,
      on: user.id == participant.user_id,
      order_by: [asc: participant.inserted_at],
      select: {participant, user}
    )
    |> Repo.all()
    |> Enum.map(fn {participant, user} ->
      present_participant(participant)
      |> Map.put(:username, user.username)
      |> Map.put(:display_name, user.display_name)
    end)
  end

  def list_presented_signals(call_id) do
    from(signal in CallSignal,
      where: signal.call_id == ^call_id,
      order_by: [asc: signal.inserted_at],
      limit: 50
    )
    |> Repo.all()
    |> Enum.map(&present_signal/1)
  end

  def list_presented_call_room_members(room_id) do
    from(member in CallRoomMember,
      where: member.call_room_id == ^room_id and is_nil(member.left_at),
      join: user in User,
      on: user.id == member.user_id,
      order_by: [asc: member.joined_at],
      select: %{
        id: member.id,
        user_id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: member.role,
        joined_at: member.joined_at
      }
    )
    |> Repo.all()
    |> Enum.map(fn member ->
      %{member | joined_at: iso_or_nil(member.joined_at)}
    end)
  end

  def current_room_state(%CallSession{status: "active"} = call) do
    MembraneRoom.describe(call.id)
  end

  def current_room_state(_call), do: nil

  def iso_or_nil(nil), do: nil
  def iso_or_nil(%DateTime{} = value), do: DateTime.to_iso8601(value)
end
