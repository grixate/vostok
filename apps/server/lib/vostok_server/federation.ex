defmodule VostokServer.Federation do
  @moduledoc """
  Stage 6 federation queue delivery and mTLS transport workflow.
  """

  import Ecto.Query

  alias VostokServer.Federation.{DeliveryJob, DeliveryWorker, Peer}
  alias VostokServer.Identity.{Device, User}
  alias VostokServer.Messaging
  alias VostokServer.Repo

  @default_retry_backoff_seconds 30
  @default_retry_backoff_cap_seconds 900

  def list_peers do
    Peer
    |> Repo.all()
    |> Enum.sort_by(& &1.inserted_at, {:desc, DateTime})
    |> Enum.map(&present_peer/1)
  end

  def list_delivery_jobs do
    DeliveryJob
    |> Repo.all()
    |> Enum.sort_by(& &1.inserted_at, {:desc, DateTime})
    |> Enum.map(&present_delivery_job/1)
  end

  def queue_outbound_message(chat_id, payload)
      when is_binary(chat_id) and is_map(payload) do
    peers =
      from(peer in Peer,
        where: peer.status == "active",
        order_by: [asc: peer.domain]
      )
      |> Repo.all()

    Enum.each(peers, fn peer ->
      queue_delivery(peer.id, %{
        "event_type" => "message_relay_v1",
        "payload" =>
          Map.merge(payload, %{
            "chat_id" => chat_id
          })
      })
    end)

    :ok
  end

  def queue_delivery(peer_id, attrs \\ %{}) when is_binary(peer_id) and is_map(attrs) do
    with %Peer{} <- Repo.get(Peer, peer_id),
         {:ok, normalized} <- normalize_delivery_attrs(peer_id, attrs) do
      Repo.transaction(fn ->
        with {:ok, delivery_job} <-
               %DeliveryJob{}
               |> DeliveryJob.changeset(normalized)
               |> Repo.insert(),
             {:ok, _oban_job} <- enqueue_delivery_job(delivery_job.id) do
          present_delivery_job(delivery_job)
        else
          {:error, %Ecto.Changeset{} = changeset} ->
            Repo.rollback({:validation, format_changeset_error(changeset)})

          {:error, reason} ->
            Repo.rollback({:unknown, format_background_error(reason)})
        end
      end)
      |> case do
        {:ok, delivery_job} -> {:ok, delivery_job}
        {:error, error} -> {:error, error}
      end
    else
      nil ->
        {:error, {:not_found, "Federation peer not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def attempt_delivery(job_id, attrs \\ %{}) when is_binary(job_id) and is_map(attrs) do
    with %DeliveryJob{} = job <- Repo.get(DeliveryJob, job_id),
         {:ok, normalized} <- normalize_delivery_attempt_attrs(job, attrs) do
      job
      |> DeliveryJob.changeset(normalized)
      |> Repo.update()
      |> case do
        {:ok, updated_job} -> {:ok, present_delivery_job(updated_job)}
        {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
      end
    else
      nil ->
        {:error, {:not_found, "Federation delivery job not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def dispatch_delivery(job_id) when is_binary(job_id) do
    with {:ok, %DeliveryJob{} = job, %Peer{} = peer} <- fetch_job_with_peer(job_id) do
      cond do
        job.direction != "outbound" ->
          {:discard, present_delivery_job(job)}

        job.status == "delivered" ->
          {:ok, present_delivery_job(job)}

        not delivery_ready_for_attempt?(job) ->
          retry_seconds = seconds_until_available(job)
          {:retry, present_delivery_job(job), retry_seconds}

        peer.status == "disabled" ->
          fail_preflight(job, "Peer is disabled.", :permanent)

        peer.status != "active" ->
          fail_preflight(job, "Peer is not active yet.", :retryable)

        true ->
          dispatch_over_transport(job, peer)
      end
    end
  end

  def receive_delivery(attrs, opts \\ []) when is_map(attrs) and is_list(opts) do
    with {:ok, normalized} <- normalize_inbound_delivery_attrs(attrs),
         %Peer{} = peer <- Repo.get_by(Peer, domain: normalized.source_domain),
         :ok <- authorize_inbound_peer(peer, opts),
         :ok <- verify_inbound_signature(normalized) do
      Repo.transaction(fn ->
        with {:ok, inbound_job} <- upsert_inbound_delivery(peer, normalized),
             :ok <- ingest_inbound_event(peer, normalized),
             {:ok, _peer} <- touch_peer_last_seen(peer) do
          present_delivery_job(inbound_job)
        else
          {:error, %Ecto.Changeset{} = changeset} ->
            Repo.rollback({:validation, format_changeset_error(changeset)})

          {:error, reason} ->
            Repo.rollback(reason)
        end
      end)
      |> case do
        {:ok, delivery_job} -> {:ok, delivery_job}
        {:error, reason} -> {:error, reason}
      end
    else
      nil ->
        {:error, {:not_found, "Federation peer not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def create_peer(attrs) when is_map(attrs) do
    with {:ok, normalized} <- normalize_peer_attrs(attrs) do
      %Peer{}
      |> Peer.changeset(normalized)
      |> Repo.insert()
      |> case do
        {:ok, peer} -> {:ok, present_peer(peer)}
        {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
      end
    end
  end

  def update_peer_status(peer_id, status) when is_binary(peer_id) do
    with %Peer{} = peer <- Repo.get(Peer, peer_id),
         {:ok, normalized_status} <- normalize_status(status) do
      peer
      |> Peer.changeset(%{
        status: normalized_status,
        last_error: nil
      })
      |> Repo.update()
      |> case do
        {:ok, updated_peer} -> {:ok, present_peer(updated_peer)}
        {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
      end
    else
      nil ->
        {:error, {:not_found, "Federation peer not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def create_peer_invite(peer_id) when is_binary(peer_id) do
    with %Peer{} = peer <- Repo.get(Peer, peer_id) do
      invite_token = :crypto.strong_rand_bytes(32) |> Base.url_encode64(padding: false)
      invite_token_hash = sha256_hex(invite_token)

      peer
      |> Peer.changeset(%{
        status: "pending",
        trust_state: "invited",
        invite_token_hash: invite_token_hash,
        trusted_at: nil,
        last_error: nil
      })
      |> Repo.update()
      |> case do
        {:ok, updated_peer} ->
          {:ok, %{peer: present_peer(updated_peer), invite_token: invite_token}}

        {:error, changeset} ->
          {:error, {:validation, format_changeset_error(changeset)}}
      end
    else
      nil ->
        {:error, {:not_found, "Federation peer not found."}}
    end
  end

  def accept_peer_invite(attrs) when is_map(attrs) do
    with {:ok, domain, invite_token} <- normalize_invite_acceptance(attrs),
         %Peer{} = peer <- Repo.get_by(Peer, domain: domain),
         :ok <- verify_invite_token(peer, invite_token) do
      peer
      |> Peer.changeset(%{
        status: "active",
        trust_state: "trusted",
        trusted_at: DateTime.utc_now(),
        invite_token_hash: nil,
        last_error: nil
      })
      |> Repo.update()
      |> case do
        {:ok, updated_peer} ->
          {:ok, present_peer(updated_peer)}

        {:error, changeset} ->
          {:error, {:validation, format_changeset_error(changeset)}}
      end
    else
      nil ->
        {:error, {:not_found, "Federation peer not found."}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def record_peer_heartbeat(peer_id) when is_binary(peer_id) do
    with %Peer{} = peer <- Repo.get(Peer, peer_id),
         {:ok, updated_peer} <- touch_peer_last_seen(peer) do
      {:ok, present_peer(updated_peer)}
    else
      nil ->
        {:error, {:not_found, "Federation peer not found."}}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:error, {:validation, format_changeset_error(changeset)}}
    end
  end

  defp normalize_peer_attrs(attrs) do
    domain = attrs |> Map.get("domain") |> normalize_string()
    display_name = attrs |> Map.get("display_name") |> normalize_string()

    if is_nil(domain) do
      {:error, {:validation, "domain is required."}}
    else
      {:ok,
       %{
         domain: domain,
         display_name: display_name,
         status: "pending",
         trust_state: "untrusted"
       }}
    end
  end

  defp normalize_invite_acceptance(attrs) when is_map(attrs) do
    domain = attrs |> Map.get("domain") |> normalize_string()
    invite_token = attrs |> Map.get("invite_token") |> normalize_string()

    cond do
      is_nil(domain) ->
        {:error, {:validation, "domain is required."}}

      is_nil(invite_token) ->
        {:error, {:validation, "invite_token is required."}}

      true ->
        {:ok, domain, invite_token}
    end
  end

  defp verify_invite_token(%Peer{invite_token_hash: nil}, _invite_token) do
    {:error, {:unauthorized, "This peer does not have an active invite token."}}
  end

  defp verify_invite_token(%Peer{} = peer, invite_token) when is_binary(invite_token) do
    if peer.invite_token_hash == sha256_hex(invite_token) do
      :ok
    else
      {:error, {:unauthorized, "Federation invite token is invalid."}}
    end
  end

  defp normalize_status(status) when is_binary(status) do
    case normalize_string(status) do
      "pending" = normalized_status -> {:ok, normalized_status}
      "active" = normalized_status -> {:ok, normalized_status}
      "disabled" = normalized_status -> {:ok, normalized_status}
      _ -> {:error, {:validation, "status must be pending, active, or disabled."}}
    end
  end

  defp normalize_status(_),
    do: {:error, {:validation, "status must be pending, active, or disabled."}}

  defp normalize_delivery_attrs(peer_id, attrs) do
    event_type =
      attrs
      |> Map.get("event_type", "message_relay")
      |> normalize_string()

    payload =
      case Map.get(attrs, "payload", %{}) do
        payload when is_map(payload) -> payload
        _ -> nil
      end

    if is_nil(event_type) do
      {:error, {:validation, "event_type is required."}}
    else
      {:ok,
       %{
         peer_id: peer_id,
         direction: "outbound",
         event_type: event_type,
         status: "queued",
         payload: payload || %{},
         remote_delivery_id: nil,
         attempt_count: 0,
         available_at: DateTime.utc_now(),
         last_error: nil
       }}
    end
  end

  defp normalize_delivery_attempt_attrs(%DeliveryJob{} = job, attrs) do
    outcome =
      attrs
      |> Map.get("outcome", "failed")
      |> normalize_string()

    last_error = attrs |> Map.get("last_error") |> normalize_string()
    now = DateTime.utc_now()

    case outcome do
      "processing" ->
        {:ok,
         %{
           status: "processing",
           attempt_count: job.attempt_count + 1,
           last_attempted_at: now
         }}

      "delivered" ->
        {:ok,
         %{
           status: "delivered",
           attempt_count: job.attempt_count + 1,
           last_attempted_at: now,
           delivered_at: now,
           last_error: nil
         }}

      "failed" ->
        {:ok,
         %{
           status: "failed",
           attempt_count: job.attempt_count + 1,
           last_attempted_at: now,
           available_at: DateTime.add(now, 30, :second),
           last_error: last_error || "Delivery attempt failed."
         }}

      _ ->
        {:error, {:validation, "outcome must be processing, delivered, or failed."}}
    end
  end

  defp normalize_inbound_delivery_attrs(attrs) do
    source_domain =
      attrs
      |> Map.get("source_domain")
      |> normalize_string()

    event_type =
      attrs
      |> Map.get("event_type")
      |> normalize_string()

    remote_delivery_id =
      attrs
      |> Map.get("delivery_id")
      |> normalize_string()

    idempotency_key =
      attrs
      |> Map.get("idempotency_key")
      |> normalize_string()

    signature =
      attrs
      |> Map.get("signature")
      |> normalize_string()

    payload =
      case Map.get(attrs, "payload", %{}) do
        map when is_map(map) -> map
        _ -> nil
      end

    cond do
      is_nil(source_domain) ->
        {:error, {:validation, "source_domain is required."}}

      is_nil(event_type) ->
        {:error, {:validation, "event_type is required."}}

      is_nil(payload) ->
        {:error, {:validation, "payload must be an object."}}

      true ->
        {:ok,
         %{
           source_domain: source_domain,
           event_type: event_type,
           payload: payload,
           remote_delivery_id: remote_delivery_id,
           idempotency_key: idempotency_key,
           signature: signature
         }}
    end
  end

  defp authorize_inbound_peer(%Peer{status: "active"}, opts) do
    require_client_cert? = transport_config(:require_client_cert, false)

    if require_client_cert? do
      peer_data = opts |> Keyword.get(:peer_data, %{}) |> normalize_map()

      case Map.get(peer_data, :ssl_cert) do
        ssl_cert when is_binary(ssl_cert) and byte_size(ssl_cert) > 0 -> :ok
        _ -> {:error, {:unauthorized, "Federation mTLS client certificate is required."}}
      end
    else
      :ok
    end
  end

  defp authorize_inbound_peer(_peer, _opts),
    do: {:error, {:unauthorized, "Federation peer is not active."}}

  defp verify_inbound_signature(normalized) when is_map(normalized) do
    signing_secret = transport_config(:signing_secret, nil)

    if is_nil(signing_secret) do
      :ok
    else
      provided_signature = normalize_string(Map.get(normalized, :signature))

      if is_nil(provided_signature) do
        {:error, {:unauthorized, "Federation signature is required."}}
      else
        expected_signature =
          delivery_signature(
            signing_secret,
            normalized.source_domain,
            normalized.event_type,
            normalized.remote_delivery_id,
            normalized.idempotency_key,
            normalized.payload
          )

        if expected_signature == provided_signature do
          :ok
        else
          {:error, {:unauthorized, "Federation signature is invalid."}}
        end
      end
    end
  end

  defp ingest_inbound_event(%Peer{} = peer, %{event_type: "message_relay_v1", payload: payload}) do
    with {:ok, relay_device_id} <- ensure_peer_relay_device(peer),
         {:ok, chat_id, message_attrs} <- normalize_inbound_message_payload(payload),
         {:ok, _result} <-
           Messaging.ingest_federated_message(chat_id, relay_device_id, message_attrs) do
      :ok
    end
  end

  defp ingest_inbound_event(_peer, _normalized), do: :ok

  defp normalize_inbound_message_payload(payload) when is_map(payload) do
    chat_id = payload |> Map.get("chat_id") |> normalize_string()
    client_id = payload |> Map.get("client_id") |> normalize_string()
    ciphertext = payload |> Map.get("ciphertext") |> normalize_string()
    message_kind = payload |> Map.get("message_kind") |> normalize_string() || "text"
    header = payload |> Map.get("header") |> normalize_string()
    crypto_scheme = payload |> Map.get("crypto_scheme") |> normalize_string()
    sender_key_id = payload |> Map.get("sender_key_id") |> normalize_string()
    sender_key_epoch = Map.get(payload, "sender_key_epoch")
    reply_to_message_id = payload |> Map.get("reply_to_message_id") |> normalize_string()

    recipient_envelopes =
      case Map.get(payload, "recipient_envelopes") do
        map when is_map(map) -> map
        _ -> nil
      end

    cond do
      is_nil(chat_id) ->
        {:error, {:validation, "Federation message payload is missing chat_id."}}

      is_nil(client_id) ->
        {:error, {:validation, "Federation message payload is missing client_id."}}

      is_nil(ciphertext) ->
        {:error, {:validation, "Federation message payload is missing ciphertext."}}

      true ->
        attrs =
          %{
            "client_id" => client_id,
            "ciphertext" => ciphertext,
            "message_kind" => message_kind
          }
          |> maybe_put("header", header)
          |> maybe_put("crypto_scheme", crypto_scheme)
          |> maybe_put("sender_key_id", sender_key_id)
          |> maybe_put_integer("sender_key_epoch", sender_key_epoch)
          |> maybe_put("reply_to_message_id", reply_to_message_id)
          |> maybe_put("recipient_envelopes", recipient_envelopes)

        {:ok, chat_id, attrs}
    end
  end

  defp normalize_inbound_message_payload(_payload) do
    {:error, {:validation, "Federation message payload must be an object."}}
  end

  defp ensure_peer_relay_device(%Peer{} = peer) do
    username = relay_username(peer.domain)
    device_name = relay_device_name(peer.domain)

    with {:ok, user} <- ensure_relay_user(username),
         {:ok, device} <- ensure_relay_device(user, device_name) do
      {:ok, device.id}
    end
  end

  defp ensure_relay_user(username) when is_binary(username) do
    case Repo.get_by(User, username: username) do
      %User{} = user ->
        {:ok, user}

      nil ->
        %User{}
        |> User.changeset(%{
          username: username,
          identity_public_key: :crypto.strong_rand_bytes(32)
        })
        |> Repo.insert()
        |> case do
          {:ok, user} ->
            {:ok, user}

          {:error, %Ecto.Changeset{} = changeset} ->
            {:error, {:validation, format_changeset_error(changeset)}}
        end
    end
  end

  defp ensure_relay_device(%User{} = user, device_name) when is_binary(device_name) do
    case Repo.get_by(Device, user_id: user.id, device_name: device_name) do
      %Device{} = device ->
        {:ok, device}

      nil ->
        %Device{}
        |> Device.changeset(%{
          user_id: user.id,
          device_name: device_name,
          identity_public_key: :crypto.strong_rand_bytes(32)
        })
        |> Repo.insert()
        |> case do
          {:ok, device} ->
            {:ok, device}

          {:error, %Ecto.Changeset{} = changeset} ->
            {:error, {:validation, format_changeset_error(changeset)}}
        end
    end
  end

  defp relay_username(domain) when is_binary(domain) do
    hash =
      domain
      |> :erlang.phash2(2_176_782_335)
      |> Integer.to_string(36)
      |> String.pad_leading(8, "0")

    "fed#{hash}" |> String.slice(0, 32)
  end

  defp relay_device_name(domain) when is_binary(domain) do
    "Federation Relay #{domain}"
    |> String.slice(0, 64)
  end

  defp upsert_inbound_delivery(%Peer{} = peer, normalized) do
    case normalized.remote_delivery_id do
      remote_delivery_id when is_binary(remote_delivery_id) ->
        case Repo.get_by(DeliveryJob,
               peer_id: peer.id,
               direction: "inbound",
               remote_delivery_id: remote_delivery_id
             ) do
          %DeliveryJob{} = existing ->
            {:ok, existing}

          nil ->
            insert_inbound_delivery(peer.id, normalized)
        end

      _ ->
        insert_inbound_delivery(peer.id, normalized)
    end
  end

  defp insert_inbound_delivery(peer_id, normalized) do
    now = DateTime.utc_now()

    attrs = %{
      peer_id: peer_id,
      direction: "inbound",
      event_type: normalized.event_type,
      status: "delivered",
      payload: normalized.payload,
      remote_delivery_id: normalized.remote_delivery_id,
      attempt_count: 1,
      available_at: now,
      last_attempted_at: now,
      delivered_at: now,
      last_error: nil
    }

    %DeliveryJob{}
    |> DeliveryJob.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, inbound_job} ->
        {:ok, inbound_job}

      {:error, %Ecto.Changeset{} = changeset} ->
        if duplicate_remote_delivery_id?(changeset, normalized.remote_delivery_id) do
          Repo.get_by(DeliveryJob,
            peer_id: peer_id,
            direction: "inbound",
            remote_delivery_id: normalized.remote_delivery_id
          )
          |> case do
            %DeliveryJob{} = existing -> {:ok, existing}
            nil -> {:error, changeset}
          end
        else
          {:error, changeset}
        end
    end
  end

  defp duplicate_remote_delivery_id?(changeset, remote_delivery_id)
       when is_binary(remote_delivery_id) do
    Enum.any?(changeset.errors, fn
      {:remote_delivery_id, {_message, meta}} -> meta[:constraint] == :unique
      _ -> false
    end)
  end

  defp duplicate_remote_delivery_id?(_changeset, _remote_delivery_id), do: false

  defp touch_peer_last_seen(%Peer{} = peer) do
    peer
    |> Peer.changeset(%{
      status: "active",
      last_error: nil,
      last_seen_at: DateTime.utc_now()
    })
    |> Repo.update()
  end

  defp fetch_job_with_peer(job_id) do
    with %DeliveryJob{} = job <- Repo.get(DeliveryJob, job_id),
         %Peer{} = peer <- Repo.get(Peer, job.peer_id) do
      {:ok, job, peer}
    else
      nil -> {:error, {:not_found, "Federation delivery job or peer not found."}}
    end
  end

  defp dispatch_over_transport(%DeliveryJob{} = job, %Peer{} = peer) do
    with {:ok, %DeliveryJob{} = processing_job} <- mark_job_processing(job),
         {:ok, _transport_response} <- deliver_via_transport(peer, processing_job),
         {:ok, %DeliveryJob{} = delivered_job} <- mark_job_delivered(processing_job) do
      {:ok, present_delivery_job(delivered_job)}
    else
      {:error, {:retryable, message}} ->
        handle_dispatch_failure(job, message, :retryable)

      {:error, {:permanent, message}} ->
        handle_dispatch_failure(job, message, :permanent)

      {:error, {:validation, _message} = reason} ->
        {:error, reason}

      {:error, {:unknown, _message} = reason} ->
        {:error, reason}

      {:error, reason} ->
        handle_dispatch_failure(job, format_transport_failure(reason), :retryable)
    end
  end

  defp fail_preflight(%DeliveryJob{} = job, message, retry_type) do
    with {:ok, failed_job} <- mark_job_failed(job, message, retry_type, true) do
      present = present_delivery_job(failed_job)

      case retry_type do
        :retryable ->
          {:retry, present, seconds_until_available(failed_job)}

        :permanent ->
          {:discard, present}
      end
    else
      {:error, %Ecto.Changeset{} = changeset} ->
        {:error, {:validation, format_changeset_error(changeset)}}

      {:error, reason} ->
        {:error, {:unknown, format_background_error(reason)}}
    end
  end

  defp handle_dispatch_failure(%DeliveryJob{} = original_job, message, retry_type) do
    with refreshed_job when not is_nil(refreshed_job) <- Repo.get(DeliveryJob, original_job.id),
         {:ok, failed_job} <- mark_job_failed(refreshed_job, message, retry_type, false) do
      present = present_delivery_job(failed_job)

      case retry_type do
        :retryable ->
          {:retry, present, seconds_until_available(failed_job)}

        :permanent ->
          {:discard, present}
      end
    else
      nil ->
        {:error, {:not_found, "Federation delivery job not found during failure update."}}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:error, {:validation, format_changeset_error(changeset)}}

      {:error, reason} ->
        {:error, {:unknown, format_background_error(reason)}}
    end
  end

  defp deliver_via_transport(%Peer{} = peer, %DeliveryJob{} = job) do
    adapter = transport_adapter()

    if Code.ensure_loaded?(adapter) and function_exported?(adapter, :deliver, 3) do
      adapter.deliver(peer, job, transport_options())
    else
      {:error, {:permanent, "Configured federation transport adapter is invalid."}}
    end
  end

  defp mark_job_processing(%DeliveryJob{} = job) do
    now = DateTime.utc_now()

    job
    |> DeliveryJob.changeset(%{
      status: "processing",
      attempt_count: job.attempt_count + 1,
      last_attempted_at: now,
      last_error: nil
    })
    |> Repo.update()
    |> case do
      {:ok, updated_job} -> {:ok, updated_job}
      {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
    end
  end

  defp mark_job_delivered(%DeliveryJob{} = job) do
    now = DateTime.utc_now()

    job
    |> DeliveryJob.changeset(%{
      status: "delivered",
      delivered_at: now,
      available_at: now,
      last_error: nil
    })
    |> Repo.update()
    |> case do
      {:ok, updated_job} -> {:ok, updated_job}
      {:error, changeset} -> {:error, {:validation, format_changeset_error(changeset)}}
    end
  end

  defp mark_job_failed(%DeliveryJob{} = job, error_message, retry_type, increment_attempt?) do
    now = DateTime.utc_now()

    attempt_count =
      if increment_attempt? do
        job.attempt_count + 1
      else
        job.attempt_count
      end

    retry_seconds = retry_backoff_seconds(attempt_count)

    available_at =
      case retry_type do
        :retryable -> DateTime.add(now, retry_seconds, :second)
        :permanent -> now
      end

    attrs = %{
      status: "failed",
      attempt_count: attempt_count,
      last_attempted_at: now,
      available_at: available_at,
      last_error: normalize_string(error_message) || "Delivery attempt failed."
    }

    job
    |> DeliveryJob.changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated_job} -> {:ok, updated_job}
      {:error, changeset} -> {:error, changeset}
    end
  end

  defp delivery_ready_for_attempt?(%DeliveryJob{available_at: nil}), do: true

  defp delivery_ready_for_attempt?(%DeliveryJob{available_at: %DateTime{} = available_at}) do
    DateTime.compare(available_at, DateTime.utc_now()) != :gt
  end

  defp seconds_until_available(%DeliveryJob{available_at: nil}), do: 0

  defp seconds_until_available(%DeliveryJob{available_at: %DateTime{} = available_at}) do
    case DateTime.diff(available_at, DateTime.utc_now(), :second) do
      diff when diff > 0 -> diff
      _ -> 0
    end
  end

  defp retry_backoff_seconds(attempt_count)
       when is_integer(attempt_count) and attempt_count >= 0 do
    base = transport_config(:retry_backoff_seconds, @default_retry_backoff_seconds)
    cap = transport_config(:retry_backoff_cap_seconds, @default_retry_backoff_cap_seconds)

    multiplier = Integer.pow(2, max(attempt_count - 1, 0))
    min(base * multiplier, cap)
  end

  defp transport_adapter do
    Application.get_env(
      :vostok_server,
      :federation_transport_adapter,
      VostokServer.Federation.Transport.MTLS
    )
  end

  defp transport_options do
    Application.get_env(:vostok_server, :federation_transport, [])
    |> normalize_keyword_list()
  end

  defp transport_config(key, default) do
    transport_options()
    |> Keyword.get(key, default)
    |> case do
      nil -> default
      value -> value
    end
  end

  defp normalize_keyword_list(options) when is_list(options), do: options
  defp normalize_keyword_list(%{} = options), do: Map.to_list(options)
  defp normalize_keyword_list(_), do: []

  defp normalize_map(%{} = map), do: map
  defp normalize_map(options) when is_list(options), do: Map.new(options)
  defp normalize_map(_), do: %{}

  defp format_transport_failure({kind, message}) when is_atom(kind) and is_binary(message),
    do: message

  defp format_transport_failure(message) when is_binary(message), do: message
  defp format_transport_failure(reason), do: inspect(reason)

  defp present_peer(%Peer{} = peer) do
    %{
      id: peer.id,
      domain: peer.domain,
      display_name: peer.display_name,
      status: peer.status,
      trust_state: peer.trust_state,
      last_error: peer.last_error,
      last_seen_at: iso_or_nil(peer.last_seen_at),
      trusted_at: iso_or_nil(peer.trusted_at),
      inserted_at: iso_or_nil(peer.inserted_at),
      updated_at: iso_or_nil(peer.updated_at)
    }
  end

  defp present_delivery_job(%DeliveryJob{} = delivery_job) do
    %{
      id: delivery_job.id,
      peer_id: delivery_job.peer_id,
      direction: delivery_job.direction,
      event_type: delivery_job.event_type,
      status: delivery_job.status,
      payload: delivery_job.payload,
      remote_delivery_id: delivery_job.remote_delivery_id,
      attempt_count: delivery_job.attempt_count,
      available_at: iso_or_nil(delivery_job.available_at),
      last_attempted_at: iso_or_nil(delivery_job.last_attempted_at),
      delivered_at: iso_or_nil(delivery_job.delivered_at),
      last_error: delivery_job.last_error,
      inserted_at: iso_or_nil(delivery_job.inserted_at),
      updated_at: iso_or_nil(delivery_job.updated_at)
    }
  end

  defp enqueue_delivery_job(delivery_job_id) when is_binary(delivery_job_id) do
    %{"delivery_job_id" => delivery_job_id}
    |> DeliveryWorker.new()
    |> Oban.insert()
  end

  defp maybe_put(map, _key, nil) when is_map(map), do: map

  defp maybe_put(map, key, value) when is_map(map) and is_binary(key) do
    Map.put(map, key, value)
  end

  defp maybe_put_integer(map, _key, nil) when is_map(map), do: map

  defp maybe_put_integer(map, key, value)
       when is_map(map) and is_binary(key) and is_integer(value) and value >= 0 do
    Map.put(map, key, value)
  end

  defp maybe_put_integer(map, key, value)
       when is_map(map) and is_binary(key) and is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {parsed, ""} when parsed >= 0 -> Map.put(map, key, parsed)
      _ -> map
    end
  end

  defp maybe_put_integer(map, _key, _value) when is_map(map), do: map

  defp delivery_signature(
         secret,
         source_domain,
         event_type,
         delivery_id,
         idempotency_key,
         payload
       ) do
    payload_digest = payload_digest(payload)

    canonical =
      [
        normalize_string(source_domain) || "",
        normalize_string(event_type) || "",
        normalize_string(delivery_id) || "",
        normalize_string(idempotency_key) || "",
        payload_digest
      ]
      |> Enum.join("|")

    :crypto.mac(:hmac, :sha256, secret, canonical)
    |> Base.encode64()
  end

  defp payload_digest(payload) when is_map(payload) do
    payload
    |> canonicalize_map()
    |> Jason.encode!()
    |> sha256_hex()
  end

  defp payload_digest(payload) do
    payload
    |> inspect()
    |> sha256_hex()
  end

  defp canonicalize_map(map) when is_map(map) do
    map
    |> Enum.map(fn {key, value} ->
      normalized_value =
        cond do
          is_map(value) -> canonicalize_map(value)
          is_list(value) -> Enum.map(value, &canonicalize_value/1)
          true -> canonicalize_value(value)
        end

      {to_string(key), normalized_value}
    end)
    |> Enum.sort_by(&elem(&1, 0))
    |> Map.new()
  end

  defp canonicalize_value(value) when is_map(value), do: canonicalize_map(value)
  defp canonicalize_value(value) when is_list(value), do: Enum.map(value, &canonicalize_value/1)
  defp canonicalize_value(value), do: value

  defp normalize_string(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_string(_), do: nil

  defp sha256_hex(value) when is_binary(value) do
    :crypto.hash(:sha256, value)
    |> Base.encode16(case: :lower)
  end

  defp format_changeset_error(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
    |> Enum.map(fn {field, [message | _]} -> "#{field} #{message}" end)
    |> List.first()
    |> Kernel.||("The federation record could not be saved.")
  end

  defp format_background_error(%Ecto.Changeset{} = changeset),
    do: format_changeset_error(changeset)

  defp format_background_error(error) when is_binary(error), do: error
  defp format_background_error(error), do: inspect(error)

  defp iso_or_nil(nil), do: nil
  defp iso_or_nil(%DateTime{} = value), do: DateTime.to_iso8601(value)
end
