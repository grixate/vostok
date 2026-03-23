defmodule VostokServer.Storage.PolicyEngine do
  @moduledoc """
  Resolves the effective retention policy for a media item.
  Policy hierarchy: per-media override → per-chat → per-media-type → global defaults.
  """

  alias VostokServer.Repo

  import Ecto.Query

  @profiles %{
    minimal: %{
      max_age_days: 7,
      evict_after_delivery: true,
      delivery_grace_period_hours: 24,
      offload_to_object_store: false,
      keep_thumbnails: true,
      thumbnail_retention_days: 90
    },
    standard: %{
      max_age_days: 30,
      evict_after_delivery: true,
      delivery_grace_period_hours: 48,
      offload_to_object_store: true,
      object_store_retention_days: 90,
      keep_thumbnails: true,
      thumbnail_retention_days: nil
    },
    archival: %{
      max_age_days: nil,
      evict_after_delivery: false,
      offload_to_object_store: true,
      object_store_retention_days: nil,
      keep_thumbnails: true,
      thumbnail_retention_days: nil
    }
  }

  @doc "Get the default policy based on the configured profile."
  def default_policy do
    profile = config()[:retention_profile] || :standard
    Map.get(@profiles, profile, @profiles.standard)
  end

  @doc "Get the effective policy for a media upload."
  def effective_policy(upload) do
    base = default_policy()

    # Layer 1: per-media-type override
    type_policy = lookup_policy("media_type", media_type_scope(upload.content_type))
    base = Map.merge(base, type_policy || %{})

    # Layer 2: per-chat override (requires chat_id — not always available on upload)
    # For now, use base
    base
  end

  @doc "List all configured policies."
  def list_policies do
    from(p in "storage_policies",
      select: %{
        id: p.id,
        scope_type: p.scope_type,
        scope_value: p.scope_value,
        policy_json: p.policy_json,
        updated_at: p.updated_at
      },
      order_by: [asc: p.scope_type, asc: p.scope_value]
    )
    |> Repo.all()
  end

  @doc "Update or create a policy."
  def upsert_policy(scope_type, scope_value, policy_map, user_id) do
    now = DateTime.utc_now()

    Repo.insert(
      %{
        id: Ecto.UUID.generate(),
        scope_type: scope_type,
        scope_value: scope_value,
        policy_json: policy_map,
        created_by: user_id,
        inserted_at: now,
        updated_at: now
      },
      source: "storage_policies",
      on_conflict: [set: [policy_json: policy_map, updated_at: now]],
      conflict_target: [:scope_type, :scope_value]
    )
  end

  @doc "Get available profile names."
  def profiles, do: Map.keys(@profiles)

  @doc "Get a specific profile's defaults."
  def profile(name), do: Map.get(@profiles, name)

  # ── Private ───────────────────────────────────────────────────────────

  defp lookup_policy(scope_type, scope_value) do
    from(p in "storage_policies",
      where: p.scope_type == ^scope_type and p.scope_value == ^scope_value,
      select: p.policy_json,
      limit: 1
    )
    |> Repo.one()
  end

  defp media_type_scope(nil), do: "*/*"
  defp media_type_scope(content_type) do
    case String.split(content_type, "/", parts: 2) do
      [type, _] -> "#{type}/*"
      _ -> "*/*"
    end
  end

  defp config do
    Application.get_env(:vostok_server, VostokServer.Storage, [])
  end
end
