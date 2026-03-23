defmodule VostokServerWeb.Api.V1.ChatController do
  use VostokServerWeb, :controller

  alias VostokServer.Identity
  alias VostokServer.Messaging

  def me(conn, _params) do
    current_user = conn.assigns.current_user
    current_device = conn.assigns[:current_device]
    current_session = conn.assigns[:current_session]

    device_payload =
      if current_device do
        %{
          id: current_device.id,
          device_name: current_device.device_name,
          prekeys: prekey_inventory(current_device.id)
        }
      else
        nil
      end

    session_payload =
      if current_session do
        %{expires_at: DateTime.to_iso8601(current_session.expires_at)}
      else
        nil
      end

    settings =
      case current_user.settings_encrypted do
        nil -> nil
        binary when is_binary(binary) ->
          case Jason.decode(binary) do
            {:ok, decoded} -> decoded
            _ -> nil
          end
      end

    json(conn, %{
      user: %{
        id: current_user.id,
        username: current_user.username,
        display_name: current_user.display_name,
        bio: current_user.bio,
        role: current_user.role
      },
      device: device_payload,
      session: session_payload,
      settings: settings
    })
  end

  def update_profile(conn, params) do
    current_user = conn.assigns.current_user

    profile_attrs =
      params
      |> Map.take(["display_name", "bio", "username"])
      |> Enum.into(%{}, fn {k, v} -> {String.to_existing_atom(k), v} end)

    case Identity.update_user_profile(current_user, profile_attrs) do
      {:ok, user} ->
        json(conn, %{
          user: %{
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            bio: user.bio,
            role: user.role
          }
        })

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "validation_failed", details: format_errors(changeset)})
    end
  end

  def upload_profile_photo(conn, %{"photo" => photo_base64, "content_type" => content_type}) do
    current_user = conn.assigns.current_user

    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    max_size = 5 * 1024 * 1024  # 5 MB

    with true <- content_type in allowed_types,
         {:ok, photo_bytes} <- Base.decode64(photo_base64),
         true <- byte_size(photo_bytes) <= max_size do
      # Store in photos directory
      photos_dir = Path.join(Application.app_dir(:vostok_server, "priv"), "photos")
      File.mkdir_p!(photos_dir)

      ext = case content_type do
        "image/jpeg" -> "jpg"
        "image/png" -> "png"
        "image/gif" -> "gif"
        "image/webp" -> "webp"
        _ -> "jpg"
      end

      filename = "#{current_user.id}.#{ext}"
      path = Path.join(photos_dir, filename)

      # Delete old photo if different extension
      if current_user.profile_photo_path do
        old_full = Path.join(photos_dir, Path.basename(current_user.profile_photo_path))
        if File.exists?(old_full), do: File.rm(old_full)
      end

      case File.write(path, photo_bytes) do
        :ok ->
          relative_path = "photos/#{filename}"
          {:ok, updated} =
            current_user
            |> VostokServer.Identity.User.photo_changeset(%{
              profile_photo_path: relative_path,
              profile_photo_content_type: content_type
            })
            |> VostokServer.Repo.update()

          json(conn, %{
            ok: true,
            photo_url: "/api/v1/me/profile/photo?v=#{System.system_time(:second)}",
            user: %{id: updated.id, username: updated.username}
          })

        {:error, reason} ->
          conn |> put_status(:internal_server_error) |> json(%{error: "Failed to save photo: #{inspect(reason)}"})
      end
    else
      false ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "Invalid content type or file too large (max 5 MB)"})
      :error ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "Invalid base64 data"})
    end
  end

  def upload_profile_photo(conn, _params) do
    conn |> put_status(:unprocessable_entity) |> json(%{error: "photo and content_type are required"})
  end

  def serve_profile_photo(conn, _params) do
    current_user = conn.assigns.current_user

    if current_user.profile_photo_path do
      photos_dir = Path.join(Application.app_dir(:vostok_server, "priv"), "photos")
      full_path = Path.join(photos_dir, Path.basename(current_user.profile_photo_path))

      if File.exists?(full_path) do
        conn
        |> put_resp_content_type(current_user.profile_photo_content_type || "image/jpeg")
        |> send_file(200, full_path)
      else
        conn |> put_status(:not_found) |> json(%{error: "Photo file not found"})
      end
    else
      conn |> put_status(:not_found) |> json(%{error: "No profile photo set"})
    end
  end

  def serve_user_photo(conn, %{"user_id" => user_id}) do
    case VostokServer.Repo.get(VostokServer.Identity.User, user_id) do
      %{profile_photo_path: path, profile_photo_content_type: ct} when is_binary(path) ->
        photos_dir = Path.join(Application.app_dir(:vostok_server, "priv"), "photos")
        full_path = Path.join(photos_dir, Path.basename(path))

        if File.exists?(full_path) do
          conn
          |> put_resp_content_type(ct || "image/jpeg")
          |> put_resp_header("cache-control", "public, max-age=3600")
          |> send_file(200, full_path)
        else
          conn |> put_status(:not_found) |> json(%{error: "not_found"})
        end

      _ ->
        conn |> put_status(:not_found) |> json(%{error: "not_found"})
    end
  end

  def delete_profile_photo(conn, _params) do
    current_user = conn.assigns.current_user

    if current_user.profile_photo_path do
      photos_dir = Path.join(Application.app_dir(:vostok_server, "priv"), "photos")
      full_path = Path.join(photos_dir, Path.basename(current_user.profile_photo_path))
      if File.exists?(full_path), do: File.rm(full_path)

      {:ok, _} =
        current_user
        |> VostokServer.Identity.User.photo_changeset(%{profile_photo_path: nil, profile_photo_content_type: nil})
        |> VostokServer.Repo.update()
    end

    json(conn, %{ok: true})
  end

  def get_settings(conn, _params) do
    current_user = conn.assigns.current_user

    settings =
      case current_user.settings_encrypted do
        nil -> %{}
        binary when is_binary(binary) ->
          case Jason.decode(binary) do
            {:ok, decoded} -> decoded
            _ -> %{}
          end
      end

    json(conn, settings)
  end

  def update_settings(conn, params) do
    current_user = conn.assigns.current_user

    case Jason.encode(params) do
      {:ok, json_binary} ->
        case Identity.update_user_settings(current_user, json_binary) do
          {:ok, _user} ->
            json(conn, params)

          {:error, _changeset} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{error: "failed_to_save_settings"})
        end

      {:error, _} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "invalid_json"})
    end
  end

  defp prekey_inventory(device_id) when is_binary(device_id) do
    case Identity.prekey_inventory(device_id) do
      {:ok, inventory} -> inventory
      _ -> nil
    end
  end

  def index(conn, _params) do
    device_id = case conn.assigns[:current_device] do
      %{id: id} -> id
      _ -> nil
    end

    chats = Messaging.list_chats_for_user(conn.assigns.current_user.id, device_id)
    json(conn, %{chats: chats})
  end

  def create_direct(conn, %{"username" => username}) do
    case Messaging.ensure_direct_chat(conn.assigns.current_user.id, username) do
      {:ok, chat} ->
        conn
        |> put_status(:created)
        |> json(%{chat: chat})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def create_direct(conn, _params) do
    render_error(conn, :validation, "username is required.")
  end

  def create_self(conn, _params) do
    case Messaging.ensure_self_chat(conn.assigns.current_user) do
      {:ok, chat} ->
        conn
        |> put_status(:created)
        |> json(%{chat: chat})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def create_group(conn, params) do
    case Messaging.create_group_chat(conn.assigns.current_user.id, params) do
      {:ok, chat} ->
        conn
        |> put_status(:created)
        |> json(%{chat: chat})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def update_group(conn, %{"chat_id" => chat_id} = params) do
    case Messaging.rename_group_chat(chat_id, conn.assigns.current_user.id, params) do
      {:ok, chat} ->
        json(conn, %{chat: chat})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def group_members(conn, %{"chat_id" => chat_id}) do
    case Messaging.list_group_members(chat_id, conn.assigns.current_user.id) do
      {:ok, members} ->
        json(conn, %{members: members})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def update_group_member(conn, %{"chat_id" => chat_id, "user_id" => user_id} = params) do
    case Messaging.update_group_member_role(
           chat_id,
           conn.assigns.current_user.id,
           user_id,
           params
         ) do
      {:ok, member} ->
        json(conn, %{member: member})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def remove_group_member(conn, %{"chat_id" => chat_id, "user_id" => user_id}) do
    case Messaging.remove_group_member(chat_id, conn.assigns.current_user.id, user_id) do
      {:ok, member} ->
        json(conn, %{member: member})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def list_group_sender_keys(conn, %{"chat_id" => chat_id}) do
    case Messaging.list_group_sender_keys(
           chat_id,
           conn.assigns.current_user.id,
           device_id(conn)
         ) do
      {:ok, sender_keys} ->
        json(conn, %{sender_keys: sender_keys})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def distribute_group_sender_keys(conn, %{"chat_id" => chat_id} = params) do
    case Messaging.distribute_group_sender_keys(
           chat_id,
           conn.assigns.current_user.id,
           device_id(conn),
           params
         ) do
      {:ok, sender_keys} ->
        conn
        |> put_status(:created)
        |> json(%{sender_keys: sender_keys})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def session_bootstrap(conn, %{"chat_id" => chat_id} = params) do
    case Messaging.bootstrap_chat_sessions(
           chat_id,
           conn.assigns.current_user.id,
           device_id(conn),
           params
         ) do
      {:ok, sessions} ->
        json(conn, %{sessions: sessions})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def session_rekey(conn, %{"chat_id" => chat_id} = params) do
    case Messaging.rekey_chat_sessions(
           chat_id,
           conn.assigns.current_user.id,
           device_id(conn),
           params
         ) do
      {:ok, sessions} ->
        json(conn, %{sessions: sessions})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def safety_numbers(conn, %{"chat_id" => chat_id}) do
    case Messaging.list_safety_numbers(
           chat_id,
           conn.assigns.current_user.id,
           device_id(conn)
         ) do
      {:ok, safety_numbers} ->
        json(conn, %{safety_numbers: safety_numbers})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def verify_safety_number(conn, %{"chat_id" => chat_id, "peer_device_id" => peer_device_id}) do
    case Messaging.verify_safety_number(
           chat_id,
           conn.assigns.current_user.id,
           device_id(conn),
           peer_device_id
         ) do
      {:ok, safety_number} ->
        json(conn, %{safety_number: safety_number})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def recipient_devices(conn, %{"chat_id" => chat_id}) do
    case Messaging.list_recipient_devices(chat_id, conn.assigns.current_user.id) do
      {:ok, recipient_devices} ->
        json(conn, %{recipient_devices: recipient_devices})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def messages(conn, %{"chat_id" => chat_id} = params) do
    opts = Map.take(params, ["limit", "before"])

    case Messaging.list_messages_for_chat(
           chat_id,
           conn.assigns.current_user.id,
           device_id(conn),
           opts
         ) do
      {:ok, %{messages: messages, has_more: has_more}} ->
        json(conn, %{messages: messages, has_more: has_more})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def mark_read(conn, %{"chat_id" => chat_id} = params) do
    case Messaging.mark_chat_read(
           chat_id,
           conn.assigns.current_user.id,
           device_id(conn),
           params
         ) do
      {:ok, read_state} ->
        # Broadcast read receipt to other chat participants
        VostokServerWeb.Endpoint.broadcast("chat:#{chat_id}", "read:update", %{
          user_id: conn.assigns.current_user.id,
          last_read_message_id: read_state[:last_read_message_id],
          read_at: read_state[:read_at]
        })
        json(conn, %{read_state: read_state})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def create_message(conn, %{"chat_id" => chat_id} = params) do
    case Messaging.create_message(
           chat_id,
           device_id(conn),
           conn.assigns.current_user.id,
           params,
           device_id(conn)
         ) do
      {:ok, message} ->
        conn
        |> put_status(:created)
        |> json(%{message: message})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def update_message(conn, %{"chat_id" => chat_id, "message_id" => message_id} = params) do
    case Messaging.edit_message(
           chat_id,
           message_id,
           device_id(conn),
           conn.assigns.current_user.id,
           params,
           device_id(conn)
         ) do
      {:ok, message} ->
        json(conn, %{message: message})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def delete_message(conn, %{"chat_id" => chat_id, "message_id" => message_id}) do
    case Messaging.delete_message(
           chat_id,
           message_id,
           device_id(conn),
           conn.assigns.current_user.id,
           device_id(conn)
         ) do
      {:ok, message} ->
        json(conn, %{message: message})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def toggle_pin(conn, %{"chat_id" => chat_id, "message_id" => message_id}) do
    case Messaging.toggle_message_pin(
           chat_id,
           message_id,
           conn.assigns.current_user.id,
           device_id(conn)
         ) do
      {:ok, message} ->
        json(conn, %{message: message})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  def toggle_reaction(conn, %{"chat_id" => chat_id, "message_id" => message_id} = params) do
    case Messaging.toggle_message_reaction(
           chat_id,
           message_id,
           conn.assigns.current_user.id,
           device_id(conn),
           params
         ) do
      {:ok, message} ->
        json(conn, %{message: message})

      {:error, {kind, message}} ->
        render_error(conn, kind, message)
    end
  end

  defp device_id(conn) do
    case conn.assigns[:current_device] do
      %{id: id} -> id
      _ -> conn.assigns.current_user.id
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end

  defp render_error(conn, :not_found, message) do
    conn
    |> put_status(:not_found)
    |> json(%{error: "not_found", message: message})
  end

  defp render_error(conn, _kind, message) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: "validation", message: message})
  end
end
