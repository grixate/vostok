defmodule VostokServerWeb.Presence do
  @moduledoc """
  Tracks online presence for connected users via Phoenix.Presence.

  Each user is tracked on the `presence:lobby` topic.  When a user joins
  the presence channel, their user_id is tracked automatically.  Other
  clients subscribe to the same topic and receive `presence_diff` events
  when users come online or go offline.
  """

  use Phoenix.Presence,
    otp_app: :vostok_server,
    pubsub_server: VostokServer.PubSub
end
