defmodule VostokServerWeb.TopicChannel do
  use VostokServerWeb, :channel

  alias VostokServer.Messaging

  @impl true
  def join("chat:" <> chat_id = topic, _params, socket) do
    case Messaging.ensure_membership(chat_id, socket.assigns.user_id) do
      {:ok, _membership} ->
        {:ok, %{status: "connected", topic: topic}, assign(socket, :topic_name, topic)}

      {:error, _reason} ->
        {:error, %{reason: "unauthorized"}}
    end
  end

  def join("call:" <> chat_id = topic, _params, socket) do
    case Messaging.ensure_membership(chat_id, socket.assigns.user_id) do
      {:ok, _membership} ->
        {:ok, %{status: "connected", topic: topic}, assign(socket, :topic_name, topic)}

      {:error, _reason} ->
        {:error, %{reason: "unauthorized"}}
    end
  end

  def join("user:" <> user_id = topic, _params, socket) do
    if socket.assigns.user_id == user_id do
      {:ok, %{status: "connected", topic: topic}, assign(socket, :topic_name, topic)}
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  def join(topic, _params, socket) do
    {:ok, %{status: "connected", topic: topic}, assign(socket, :topic_name, topic)}
  end

  @impl true
  def handle_in("ping", payload, socket) do
    {:reply, {:ok, Map.put(payload, "topic", socket.assigns.topic_name)}, socket}
  end
end
