defmodule VostokServerWeb.Api.V1.StorageAdminController do
  use VostokServerWeb, :controller

  alias VostokServer.Storage.{HotCache, Monitor, EvictionWorker, PolicyEngine, ObjectStore}

  def status(conn, _params) do
    hot_usage = HotCache.current_usage()
    hot_max = HotCache.max_bytes()
    monitor_status = Monitor.status()

    json(conn, %{
      hot_cache: %{
        usage_bytes: hot_usage,
        max_bytes: hot_max,
        usage_ratio: Float.round(hot_usage / max(hot_max, 1), 4),
        path: HotCache.file_path("_probe") |> Path.dirname()
      },
      object_store: %{
        enabled: ObjectStore.enabled?(),
        adapter: inspect(ObjectStore.adapter())
      },
      monitor: monitor_status,
      retention_profile: Application.get_env(:vostok_server, VostokServer.Storage, [])[:retention_profile] || :standard
    })
  end

  def list_policies(conn, _params) do
    policies = PolicyEngine.list_policies()
    json(conn, %{policies: policies, profiles: PolicyEngine.profiles()})
  end

  def update_policy(conn, %{"scope_type" => scope_type, "scope_value" => scope_value, "policy" => policy}) do
    case PolicyEngine.upsert_policy(scope_type, scope_value, policy, conn.assigns.current_user.id) do
      {:ok, _} ->
        json(conn, %{ok: true})

      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "validation", message: inspect(reason)})
    end
  end

  def trigger_eviction(conn, _params) do
    EvictionWorker.run_now()
    json(conn, %{ok: true, message: "Eviction run triggered."})
  end

  def update_profile(conn, %{"profile" => profile_name}) when profile_name in ["minimal", "standard", "archival"] do
    profile_atom = String.to_existing_atom(profile_name)
    current = Application.get_env(:vostok_server, VostokServer.Storage, [])
    Application.put_env(:vostok_server, VostokServer.Storage, Keyword.put(current, :retention_profile, profile_atom))

    json(conn, %{ok: true, profile: profile_name, details: PolicyEngine.profile(profile_atom)})
  end

  def update_profile(conn, _params) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: "Invalid profile. Must be one of: minimal, standard, archival"})
  end

  def test_object_store(conn, _params) do
    if ObjectStore.enabled?() do
      adapter = ObjectStore.adapter()
      test_key = "vostok-test/#{Ecto.UUID.generate()}"
      test_blob = "test-#{DateTime.utc_now()}"

      with {:ok, _} <- adapter.put(test_key, test_blob, "text/plain"),
           {:ok, retrieved} <- adapter.get(test_key),
           true <- retrieved == test_blob,
           :ok <- adapter.delete(test_key) do
        json(conn, %{ok: true, message: "Object storage connectivity verified."})
      else
        error ->
          conn
          |> put_status(:service_unavailable)
          |> json(%{ok: false, error: inspect(error)})
      end
    else
      conn
      |> put_status(:unprocessable_entity)
      |> json(%{ok: false, message: "Object storage is not enabled."})
    end
  end
end
