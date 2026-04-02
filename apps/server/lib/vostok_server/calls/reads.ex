defmodule VostokServer.Calls.Reads do
  @moduledoc false

  import Ecto.Query

  import VostokServer.Calls.Presenter,
    only: [
      call_display_title: 2,
      call_participant_count: 1,
      call_participant_preview: 2,
      current_room_state: 1,
      iso_or_nil: 1,
      list_presented_call_room_members: 1,
      list_presented_participants: 1,
      list_presented_signals: 1,
      present_call: 1,
      present_call_key_distribution: 1,
      present_call_room: 1,
      present_call_room_for_call: 1
    ]

  alias VostokServer.Calls.{
    Access,
    CallKeyDistribution,
    CallRoom,
    CallRoomMember,
    CallSession,
    MembraneRoom,
    Runtime
  }

  alias VostokServer.Identity.Device
  alias VostokServer.Messaging
  alias VostokServer.Messaging.ChatMember
  alias VostokServer.Repo

  def call_history(user_id, limit \\ 50) when is_binary(user_id) do
    chat_calls =
      from(call in CallSession,
        join: member in ChatMember,
        on: member.chat_id == call.chat_id and call.scope_type == "chat",
        where: member.user_id == ^user_id and call.status == "ended",
        order_by: [desc: call.started_at],
        limit: ^limit,
        preload: [:chat]
      )
      |> Repo.all()

    room_calls =
      from(call in CallSession,
        join: member in CallRoomMember,
        on: member.call_room_id == call.call_room_id and call.scope_type == "call_room",
        where: member.user_id == ^user_id and is_nil(member.left_at) and call.status == "ended",
        order_by: [desc: call.started_at],
        limit: ^limit,
        preload: [:call_room]
      )
      |> Repo.all()

    calls =
      (chat_calls ++ room_calls)
      |> Enum.sort_by(& &1.started_at, {:desc, DateTime})
      |> Enum.take(limit)
      |> Enum.map(fn call ->
        %{
          id: call.id,
          chat_id: call.chat_id,
          call_room_id: call.call_room_id,
          scope_type: call.scope_type,
          scope_id: call.scope_id,
          display_title: call_display_title(call, user_id),
          participant_preview: call_participant_preview(call, user_id),
          participant_count: call_participant_count(call),
          started_by_device_id: call.started_by_device_id,
          mode: call.mode,
          media_mode: call.media_mode,
          status: call.status,
          started_at: iso_or_nil(call.started_at),
          ended_at: iso_or_nil(call.ended_at),
          end_reason: call.end_reason
        }
      end)

    {:ok, %{calls: calls}}
  end

  def active_call_for_chat(chat_id, user_id) when is_binary(chat_id) and is_binary(user_id) do
    with {:ok, _membership} <- Messaging.ensure_membership(chat_id, user_id) do
      call = Access.active_call_record("chat", chat_id)

      Runtime.maybe_ensure_room(call)
      {:ok, present_call(call)}
    end
  end

  def active_call_for_room(room_id, user_id) when is_binary(room_id) and is_binary(user_id) do
    with {:ok, _membership} <- Access.ensure_call_room_membership(room_id, user_id) do
      call = Access.active_call_record("call_room", room_id)

      Runtime.maybe_ensure_room(call)
      {:ok, present_call(call)}
    end
  end

  def active_calls(user_id) when is_binary(user_id) do
    chat_calls =
      from(call in CallSession,
        join: member in ChatMember,
        on: member.chat_id == call.chat_id and call.scope_type == "chat",
        where: member.user_id == ^user_id and call.status in ["active", "ringing"],
        preload: [:chat]
      )
      |> Repo.all()

    room_calls =
      from(call in CallSession,
        join: member in CallRoomMember,
        on: member.call_room_id == call.call_room_id and call.scope_type == "call_room",
        where:
          member.user_id == ^user_id and is_nil(member.left_at) and
            call.status in ["active", "ringing"],
        preload: [:call_room]
      )
      |> Repo.all()

    {:ok,
     %{
       calls:
         (chat_calls ++ room_calls)
         |> Enum.sort_by(& &1.started_at, {:desc, DateTime})
         |> Enum.map(fn call ->
           present_call(call)
           |> Map.put(:display_title, call_display_title(call, user_id))
           |> Map.put(:participant_count, call_participant_count(call))
         end)
     }}
  end

  def get_call_room(room_id, user_id) when is_binary(room_id) and is_binary(user_id) do
    with {:ok, _membership} <- Access.ensure_call_room_membership(room_id, user_id),
         %CallRoom{} = room <- Repo.get(CallRoom, room_id) do
      {:ok,
       %{
         room: present_call_room(room),
         members: list_presented_call_room_members(room.id),
         active_call: Access.active_call_record("call_room", room.id) |> present_call()
       }}
    else
      nil -> {:error, {:not_found, "Call room not found."}}
      {:error, reason} -> {:error, reason}
    end
  end

  def list_call_room_recipient_devices(room_id, user_id)
      when is_binary(room_id) and is_binary(user_id) do
    with {:ok, _membership} <- Access.ensure_call_room_membership(room_id, user_id) do
      devices =
        from(member in CallRoomMember,
          join: device in Device,
          on: device.user_id == member.user_id and is_nil(device.revoked_at),
          where:
            member.call_room_id == ^room_id and is_nil(member.left_at) and
              not is_nil(device.encryption_public_key),
          select: %{
            device_id: device.id,
            encryption_public_key: device.encryption_public_key,
            user_id: device.user_id
          }
        )
        |> Repo.all()
        |> Enum.map(fn device ->
          %{
            device_id: device.device_id,
            user_id: device.user_id,
            encryption_public_key: Base.encode64(device.encryption_public_key)
          }
        end)

      {:ok, devices}
    end
  end

  def call_state(call_id, user_id) when is_binary(call_id) and is_binary(user_id) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Access.ensure_call_access(call, user_id) do
      Runtime.maybe_ensure_room(call)

      {:ok,
       %{
         call: present_call(call),
         call_room: present_call_room_for_call(call),
         participants: list_presented_participants(call.id),
         signals: list_presented_signals(call.id),
         room: current_room_state(call)
       }}
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def list_signals(call_id, user_id) when is_binary(call_id) and is_binary(user_id) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Access.ensure_call_access(call, user_id) do
      {:ok,
       %{
         call: present_call(call),
         call_room: present_call_room_for_call(call),
         signals: list_presented_signals(call.id)
       }}
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def list_call_keys(call_id, user_id, current_device_id)
      when is_binary(call_id) and is_binary(user_id) and is_binary(current_device_id) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Access.ensure_call_access(call, user_id) do
      keys =
        from(distribution in CallKeyDistribution,
          where:
            distribution.call_id == ^call_id and distribution.status == "active" and
              (distribution.recipient_device_id == ^current_device_id or
                 distribution.owner_device_id == ^current_device_id),
          order_by: [desc: distribution.key_epoch, desc: distribution.inserted_at]
        )
        |> Repo.all()
        |> Enum.map(&present_call_key_distribution/1)

      {:ok,
       %{
         call: present_call(call),
         call_room: present_call_room_for_call(call),
         keys: keys
       }}
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def get_webrtc_endpoint_state(call_id, user_id, current_device_id)
      when is_binary(call_id) and is_binary(user_id) and is_binary(current_device_id) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Access.ensure_call_access(call, user_id) do
      endpoint = MembraneRoom.endpoint_state(call.id, current_device_id)

      {:ok,
       %{
         call: present_call(call),
         call_room: present_call_room_for_call(call),
         endpoint: endpoint,
         room: current_room_state(call)
       }}
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def poll_webrtc_media_events(call_id, user_id, current_device_id)
      when is_binary(call_id) and is_binary(user_id) and is_binary(current_device_id) do
    with %CallSession{} = call <- Repo.get(CallSession, call_id),
         {:ok, _membership} <- Access.ensure_call_access(call, user_id) do
      result = MembraneRoom.poll_media_events(call.id, current_device_id)

      {:ok,
       %{
         call: present_call(call),
         call_room: present_call_room_for_call(call),
         endpoint: result.endpoint,
         media_events: result.media_events
       }}
    else
      nil ->
        {:error, {:not_found, "Call not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end
end
