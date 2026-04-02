defmodule VostokServer.Calls do
  @moduledoc """
  Stage 7 call session context with Membrane room orchestration and E2EE key epoch coordination.
  """

  alias VostokServer.Calls.{Access, Commands, Reads}

  def call_history(user_id, limit \\ 50), do: Reads.call_history(user_id, limit)

  def active_call_for_chat(chat_id, user_id), do: Reads.active_call_for_chat(chat_id, user_id)

  def active_call_for_room(room_id, user_id), do: Reads.active_call_for_room(room_id, user_id)

  def active_calls(user_id), do: Reads.active_calls(user_id)

  def create_call_room(user_id, attrs), do: Commands.create_call_room(user_id, attrs)

  def get_call_room(room_id, user_id), do: Reads.get_call_room(room_id, user_id)

  def list_call_room_recipient_devices(room_id, user_id),
    do: Reads.list_call_room_recipient_devices(room_id, user_id)

  def start_call(chat_id, user_id, current_device_id, attrs),
    do: Commands.start_call(chat_id, user_id, current_device_id, attrs)

  def start_call_room(room_id, user_id, current_device_id, attrs),
    do: Commands.start_call_room(room_id, user_id, current_device_id, attrs)

  def call_state(call_id, user_id), do: Reads.call_state(call_id, user_id)

  def accept_call(call_id, user_id), do: Commands.accept_call(call_id, user_id)

  def decline_call(call_id, user_id), do: Commands.decline_call(call_id, user_id)

  def join_call(call_id, user_id, current_device_id, attrs),
    do: Commands.join_call(call_id, user_id, current_device_id, attrs)

  def leave_call(call_id, user_id, current_device_id),
    do: Commands.leave_call(call_id, user_id, current_device_id)

  def end_call(call_id, user_id), do: Commands.end_call(call_id, user_id)

  def list_signals(call_id, user_id), do: Reads.list_signals(call_id, user_id)

  def list_call_keys(call_id, user_id, current_device_id),
    do: Reads.list_call_keys(call_id, user_id, current_device_id)

  def rotate_call_keys(call_id, user_id, current_device_id, attrs),
    do: Commands.rotate_call_keys(call_id, user_id, current_device_id, attrs)

  def emit_signal(call_id, user_id, current_device_id, attrs),
    do: Commands.emit_signal(call_id, user_id, current_device_id, attrs)

  def provision_webrtc_endpoint(call_id, user_id, current_device_id),
    do: Commands.provision_webrtc_endpoint(call_id, user_id, current_device_id)

  def get_webrtc_endpoint_state(call_id, user_id, current_device_id),
    do: Reads.get_webrtc_endpoint_state(call_id, user_id, current_device_id)

  def push_webrtc_media_event(call_id, user_id, current_device_id, attrs),
    do: Commands.push_webrtc_media_event(call_id, user_id, current_device_id, attrs)

  def poll_webrtc_media_events(call_id, user_id, current_device_id),
    do: Reads.poll_webrtc_media_events(call_id, user_id, current_device_id)

  def ensure_call_room_membership(room_id, user_id)
      when is_binary(room_id) and is_binary(user_id) do
    Access.ensure_call_room_membership(room_id, user_id)
  end
end
