defmodule VostokServer.Calls.Access do
  @moduledoc false

  import Ecto.Query

  alias VostokServer.Calls.{
    CallKeyDistribution,
    CallParticipant,
    CallRoomMember,
    CallSession
  }

  alias VostokServer.Messaging
  alias VostokServer.Repo

  def active_call_record(scope_type, scope_id)
      when is_binary(scope_type) and is_binary(scope_id) do
    from(call in CallSession,
      where:
        call.scope_type == ^scope_type and call.scope_id == ^scope_id and
          call.status in ["active", "ringing"],
      order_by: [desc: call.started_at],
      limit: 1
    )
    |> Repo.one()
  end

  def ensure_call_room_membership(room_id, user_id)
      when is_binary(room_id) and is_binary(user_id) do
    case from(member in CallRoomMember,
           where:
             member.call_room_id == ^room_id and member.user_id == ^user_id and
               is_nil(member.left_at)
         )
         |> Repo.one() do
      %CallRoomMember{} = membership -> {:ok, membership}
      nil -> {:error, {:not_found, "Call room not found for this user."}}
    end
  end

  def ensure_call_access(%CallSession{scope_type: "chat", chat_id: chat_id}, user_id) do
    Messaging.ensure_membership(chat_id, user_id)
  end

  def ensure_call_access(%CallSession{scope_type: "call_room", call_room_id: room_id}, user_id) do
    ensure_call_room_membership(room_id, user_id)
  end

  def ensure_active(%CallSession{status: "active"}), do: :ok
  def ensure_active(%CallSession{status: "ringing"}), do: :ok
  def ensure_active(_call), do: {:error, {:validation, "Call is no longer active."}}

  def ensure_group_join_key_available(call_id, current_device_id, key_epoch)
      when is_binary(call_id) and is_binary(current_device_id) and is_integer(key_epoch) do
    other_joined_count =
      from(participant in CallParticipant,
        where:
          participant.call_id == ^call_id and participant.status == "joined" and
            participant.device_id != ^current_device_id,
        select: count(participant.id)
      )
      |> Repo.one()

    if other_joined_count == 0 do
      :ok
    else
      distribution_count =
        from(distribution in CallKeyDistribution,
          where:
            distribution.call_id == ^call_id and
              distribution.recipient_device_id == ^current_device_id and
              distribution.key_epoch == ^key_epoch and
              distribution.status == "active",
          select: count(distribution.id)
        )
        |> Repo.one()

      if distribution_count > 0 do
        :ok
      else
        {:error,
         {:validation,
          "Group call join requires an active call key distribution for this device and epoch."}}
      end
    end
  end
end
