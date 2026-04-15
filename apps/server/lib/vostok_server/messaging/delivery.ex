defmodule VostokServer.Messaging.Delivery do
  @moduledoc false

  import Ecto.Query

  import VostokServer.Messaging.Presenter,
    only: [
      encode_binary: 1,
      iso_or_nil: 1,
      present_message: 3,
      reaction_query: 0,
      recipient_query: 0
    ]

  alias VostokServer.Federation
  alias VostokServer.Messaging.{ChatMember, Message}
  alias VostokServer.Repo
  alias VostokServerWeb.Endpoint

  def present_persisted_message(%Message{} = message, current_device_id, user_id)
      when is_binary(current_device_id) and is_binary(user_id) do
    message
    |> Repo.preload(
      recipient_envelopes: recipient_query(),
      reactions: reaction_query(),
      sender_device: [:user],
      views: []
    )
    |> present_message(current_device_id, user_id)
  end

  def present_inserted_message(%Message{} = message, current_device_id, user_id)
      when is_binary(current_device_id) and is_binary(user_id) do
    message
    |> Repo.preload(
      recipient_envelopes: recipient_query(),
      reactions: reaction_query(),
      sender_device: [:user],
      views: []
    )
    |> Map.from_struct()
    |> Map.take([
      :id,
      :chat_id,
      :client_id,
      :message_kind,
      :crypto_scheme,
      :sender_key_id,
      :sender_key_epoch,
      :sender_device_id,
      :inserted_at,
      :pinned_at,
      :edited_at,
      :deleted_at,
      :header,
      :ciphertext,
      :reply_to_message_id,
      :seq,
      :view_count,
      :views,
      :recipient_envelopes,
      :reactions
    ])
    |> present_message(current_device_id, user_id)
  end

  def maybe_queue_federation_message(chat_id, message)
      when is_binary(chat_id) and is_map(message) do
    payload = federation_message_payload(chat_id, message)

    case Federation.queue_outbound_message(chat_id, payload) do
      :ok -> :ok
      _other -> :ok
    end
  rescue
    _error -> :ok
  end

  def broadcast_message(chat_id, message_id)
      when is_binary(chat_id) and is_binary(message_id) do
    Endpoint.broadcast("chat:#{chat_id}", "message:new", %{
      chat_id: chat_id,
      message_id: message_id
    })

    member_user_ids =
      from(m in ChatMember, where: m.chat_id == ^chat_id, select: m.user_id)
      |> Repo.all()

    for user_id <- member_user_ids do
      Endpoint.broadcast("user:#{user_id}", "chat:activity", %{
        chat_id: chat_id,
        message_id: message_id
      })
    end
  end

  defp federation_message_payload(chat_id, message) do
    recipient_envelopes =
      message
      |> Map.get(:recipient_envelopes, [])
      |> Enum.reduce(%{}, fn recipient, acc ->
        case recipient do
          %{device_id: device_id, ciphertext_for_device: ciphertext_for_device}
          when is_binary(device_id) and is_binary(ciphertext_for_device) ->
            Map.put(acc, device_id, Base.encode64(ciphertext_for_device))

          _other ->
            acc
        end
      end)

    %{
      "chat_id" => chat_id,
      "message_id" => Map.get(message, :id),
      "client_id" => Map.get(message, :client_id),
      "message_kind" => Map.get(message, :message_kind),
      "crypto_scheme" => Map.get(message, :crypto_scheme),
      "sender_key_id" => Map.get(message, :sender_key_id),
      "sender_key_epoch" => Map.get(message, :sender_key_epoch),
      "sender_device_id" => Map.get(message, :sender_device_id),
      "header" => encode_binary(Map.get(message, :header)),
      "ciphertext" =>
        case Map.get(message, :ciphertext) do
          value when is_binary(value) -> Base.encode64(value)
          _ -> nil
        end,
      "reply_to_message_id" => Map.get(message, :reply_to_message_id),
      "recipient_envelopes" => recipient_envelopes,
      "inserted_at" => iso_or_nil(Map.get(message, :inserted_at))
    }
  end
end
