defmodule VostokServerWeb.ChannelCase do
  @moduledoc """
  Test case for channel interactions backed by the shared SQL sandbox.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      @endpoint VostokServerWeb.Endpoint

      use VostokServerWeb, :verified_routes

      import Phoenix.ChannelTest
      import VostokServerWeb.ChannelCase
    end
  end

  setup tags do
    VostokServer.DataCase.setup_sandbox(tags)
    :ok
  end
end
