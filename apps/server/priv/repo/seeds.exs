# Script for populating the database with dummy data.
#
# Run with: mix run priv/repo/seeds.exs
#
# Creates 6 users, 2 group chats, several direct chats,
# and messages of various kinds (text, media, attachment)
# with reactions.

import Ecto.Query

alias VostokServer.Repo
alias VostokServer.Identity.{User, Device, DeviceSession, OneTimePrekey}
alias VostokServer.Messaging.{Chat, ChatMember, Message, MessageReaction}
alias VostokServer.Messaging.{ChatDeviceSession, ChatReadState, ChatSafetyVerification, GroupSenderKey, MessageRecipient}
alias VostokServer.Media.Upload

IO.puts("\n=== Vostok Seed Data ===\n")

seed_usernames = ["alice", "bob", "carol", "dave", "eve", "frank"]

# Clean up existing seed data (in dependency order)
existing_users = Repo.all(from u in User, where: u.username in ^seed_usernames)
existing_user_ids = Enum.map(existing_users, & &1.id)

if length(existing_users) > 0 do
  IO.puts("Cleaning up #{length(existing_users)} existing seed users...\n")

  existing_device_ids =
    Repo.all(from d in Device, where: d.user_id in ^existing_user_ids, select: d.id)

  existing_chat_ids =
    Repo.all(
      from cm in ChatMember,
        where: cm.user_id in ^existing_user_ids,
        select: cm.chat_id,
        distinct: true
    )

  # Delete in dependency order
  if length(existing_chat_ids) > 0 do
    existing_message_ids =
      Repo.all(from m in Message, where: m.chat_id in ^existing_chat_ids, select: m.id)

    if length(existing_message_ids) > 0 do
      Repo.delete_all(from r in MessageReaction, where: r.message_id in ^existing_message_ids)
      Repo.delete_all(from mr in MessageRecipient, where: mr.message_id in ^existing_message_ids)
    end

    Repo.delete_all(from m in Message, where: m.chat_id in ^existing_chat_ids)
    Repo.delete_all(from cds in ChatDeviceSession, where: cds.chat_id in ^existing_chat_ids)
    Repo.delete_all(from crs in ChatReadState, where: crs.chat_id in ^existing_chat_ids)
    Repo.delete_all(from csv in ChatSafetyVerification, where: csv.chat_id in ^existing_chat_ids)
    Repo.delete_all(from gsk in GroupSenderKey, where: gsk.chat_id in ^existing_chat_ids)
    Repo.delete_all(from cm in ChatMember, where: cm.chat_id in ^existing_chat_ids)
    Repo.delete_all(from c in Chat, where: c.id in ^existing_chat_ids)
  end

  if length(existing_device_ids) > 0 do
    Repo.delete_all(from u in Upload, where: u.uploader_device_id in ^existing_device_ids)
    Repo.delete_all(from ds in DeviceSession, where: ds.device_id in ^existing_device_ids)
    Repo.delete_all(from otk in OneTimePrekey, where: otk.device_id in ^existing_device_ids)
    Repo.delete_all(from crs in ChatReadState, where: crs.device_id in ^existing_device_ids)
    Repo.delete_all(from d in Device, where: d.id in ^existing_device_ids)
  end

  Repo.delete_all(from r in MessageReaction, where: r.user_id in ^existing_user_ids)
  Repo.delete_all(from u in User, where: u.id in ^existing_user_ids)
end

now = DateTime.utc_now()

# Helper to generate Ed25519 key pairs
generate_keypair = fn ->
  {pub, priv} = :crypto.generate_key(:eddsa, :ed25519)
  {pub, priv}
end

# Helper to create a session token and return the raw token for API access
create_session = fn device ->
  raw_token = :crypto.strong_rand_bytes(32) |> Base.url_encode64(padding: false)
  token_hash = :crypto.hash(:sha256, raw_token)
  expires_at = DateTime.add(now, 365, :day)

  %DeviceSession{}
  |> DeviceSession.changeset(%{
    token_hash: token_hash,
    expires_at: expires_at,
    last_seen_at: now
  })
  |> Ecto.Changeset.put_assoc(:device, device)
  |> Repo.insert!()

  raw_token
end

# Helper to build a direct_key (sorted user IDs joined by ":")
direct_key = fn id_a, id_b ->
  [id_a, id_b] |> Enum.sort() |> Enum.join(":")
end

# ── 1. Create Users & Devices ──────────────────────────────────────────

user_specs = [
  %{username: "alice", device_name: "Alice's iPhone"},
  %{username: "bob", device_name: "Bob's Pixel"},
  %{username: "carol", device_name: "Carol's MacBook"},
  %{username: "dave", device_name: "Dave's Desktop"},
  %{username: "eve", device_name: "Eve's iPad"},
  %{username: "frank", device_name: "Frank's Laptop"}
]

users_data =
  Enum.map(user_specs, fn spec ->
    {identity_pub, _identity_priv} = generate_keypair.()
    {device_pub, _device_priv} = generate_keypair.()
    {enc_pub, _enc_priv} = :crypto.generate_key(:ecdh, :x25519)
    signed_prekey = :crypto.strong_rand_bytes(32)
    signed_prekey_sig = :crypto.strong_rand_bytes(64)

    user =
      %User{}
      |> User.changeset(%{
        username: spec.username,
        identity_public_key: identity_pub
      })
      |> Repo.insert!()

    device =
      %Device{}
      |> Device.changeset(%{
        user_id: user.id,
        device_name: spec.device_name,
        identity_public_key: device_pub,
        encryption_public_key: enc_pub,
        signed_prekey: signed_prekey,
        signed_prekey_signature: signed_prekey_sig,
        last_active_at: now
      })
      |> Repo.insert!()

    token = create_session.(device)

    %{user: user, device: device, token: token, spec: spec}
  end)

# Index by username for easy access
users = Map.new(users_data, fn d -> {d.spec.username, d} end)

IO.puts("Created #{length(users_data)} users with devices and session tokens:\n")

for d <- users_data do
  IO.puts("  #{String.pad_trailing(d.spec.username, 8)} | device: #{d.device.id}")
  IO.puts("  #{String.pad_trailing("", 8)} | token:  #{d.token}")
  IO.puts("")
end

IO.puts("Use tokens with: Authorization: Bearer <token>\n")

# ── 2. Create Group Chats ──────────────────────────────────────────────

# Group 1: "Project Alpha" – alice (admin), bob, carol, dave
group1 =
  %Chat{}
  |> Chat.changeset(%{type: "group"})
  |> Repo.insert!()

group1_members = ["alice", "bob", "carol", "dave"]

for {username, idx} <- Enum.with_index(group1_members) do
  role = if idx == 0, do: "admin", else: "member"

  %ChatMember{}
  |> ChatMember.changeset(%{role: role, joined_at: now})
  |> Ecto.Changeset.put_assoc(:chat, group1)
  |> Ecto.Changeset.put_assoc(:user, users[username].user)
  |> Repo.insert!()
end

# Group 2: "Weekend Plans" – eve (admin), frank, alice, bob
group2 =
  %Chat{}
  |> Chat.changeset(%{type: "group"})
  |> Repo.insert!()

group2_members = ["eve", "frank", "alice", "bob"]

for {username, idx} <- Enum.with_index(group2_members) do
  role = if idx == 0, do: "admin", else: "member"

  %ChatMember{}
  |> ChatMember.changeset(%{role: role, joined_at: now})
  |> Ecto.Changeset.put_assoc(:chat, group2)
  |> Ecto.Changeset.put_assoc(:user, users[username].user)
  |> Repo.insert!()
end

IO.puts("Created 2 group chats:")
IO.puts("  Group 1 (Project Alpha): #{group1.id} — members: #{Enum.join(group1_members, ", ")}")
IO.puts("  Group 2 (Weekend Plans): #{group2.id} — members: #{Enum.join(group2_members, ", ")}")
IO.puts("")

# ── 3. Create Direct Chats ────────────────────────────────────────────

direct_pairs = [
  {"alice", "bob"},
  {"alice", "carol"},
  {"bob", "dave"},
  {"eve", "frank"},
  {"carol", "eve"}
]

direct_chats =
  Enum.map(direct_pairs, fn {u1, u2} ->
    uid1 = users[u1].user.id
    uid2 = users[u2].user.id

    chat =
      %Chat{}
      |> Chat.changeset(%{type: "direct", direct_key: direct_key.(uid1, uid2)})
      |> Repo.insert!()

    for username <- [u1, u2] do
      %ChatMember{}
      |> ChatMember.changeset(%{role: "member", joined_at: now})
      |> Ecto.Changeset.put_assoc(:chat, chat)
      |> Ecto.Changeset.put_assoc(:user, users[username].user)
      |> Repo.insert!()
    end

    {u1, u2, chat}
  end)

IO.puts("Created #{length(direct_chats)} direct chats:")

for {u1, u2, chat} <- direct_chats do
  IO.puts("  #{u1} <-> #{u2}: #{chat.id}")
end

IO.puts("")

# ── 4. Create Messages ────────────────────────────────────────────────

# Helper: insert a message with a given offset in minutes from `now`
insert_message = fn chat, sender_username, message_kind, minutes_ago, opts ->
  sender = users[sender_username]
  ts = DateTime.add(now, -minutes_ago * 60, :second)
  # Dummy ciphertext – the server treats this as opaque
  dummy_ciphertext = :crypto.strong_rand_bytes(64)

  attrs = %{
    client_id: Ecto.UUID.generate(),
    ciphertext: dummy_ciphertext,
    message_kind: message_kind,
    pinned_at: opts[:pinned] && ts,
    edited_at: opts[:edited] && DateTime.add(ts, 120, :second),
    deleted_at: opts[:deleted] && DateTime.add(ts, 300, :second)
  }

  %Message{}
  |> Message.changeset(attrs)
  |> Ecto.Changeset.put_assoc(:chat, chat)
  |> Ecto.Changeset.put_assoc(:sender_device, sender.device)
  |> Repo.insert!(returning: true)
end

# Group 1 conversation (Project Alpha)
g1_messages = [
  insert_message.(group1, "alice", "text", 120, %{}),
  insert_message.(group1, "bob", "text", 115, %{}),
  insert_message.(group1, "carol", "text", 110, %{}),
  insert_message.(group1, "alice", "text", 100, %{}),
  insert_message.(group1, "dave", "text", 95, %{}),
  insert_message.(group1, "bob", "media", 90, %{}),
  insert_message.(group1, "alice", "text", 85, %{pinned: true}),
  insert_message.(group1, "carol", "attachment", 80, %{}),
  insert_message.(group1, "dave", "text", 75, %{}),
  insert_message.(group1, "alice", "text", 60, %{edited: true}),
  insert_message.(group1, "bob", "text", 50, %{}),
  insert_message.(group1, "carol", "media", 40, %{}),
  insert_message.(group1, "dave", "text", 30, %{}),
  insert_message.(group1, "alice", "text", 20, %{}),
  insert_message.(group1, "bob", "text", 10, %{})
]

# Group 2 conversation (Weekend Plans)
g2_messages = [
  insert_message.(group2, "eve", "text", 200, %{}),
  insert_message.(group2, "frank", "text", 190, %{}),
  insert_message.(group2, "alice", "text", 180, %{}),
  insert_message.(group2, "bob", "text", 170, %{}),
  insert_message.(group2, "eve", "media", 160, %{}),
  insert_message.(group2, "frank", "text", 150, %{}),
  insert_message.(group2, "alice", "attachment", 140, %{}),
  insert_message.(group2, "eve", "text", 130, %{}),
  insert_message.(group2, "bob", "text", 120, %{}),
  insert_message.(group2, "frank", "text", 100, %{pinned: true}),
  insert_message.(group2, "eve", "text", 80, %{}),
  insert_message.(group2, "alice", "media", 60, %{})
]

# Direct chat messages
dm_messages =
  Enum.flat_map(direct_chats, fn {u1, u2, chat} ->
    [
      insert_message.(chat, u1, "text", 300, %{}),
      insert_message.(chat, u2, "text", 290, %{}),
      insert_message.(chat, u1, "text", 280, %{}),
      insert_message.(chat, u2, "media", 250, %{}),
      insert_message.(chat, u1, "text", 200, %{}),
      insert_message.(chat, u2, "text", 150, %{}),
      insert_message.(chat, u1, "attachment", 100, %{}),
      insert_message.(chat, u2, "text", 50, %{})
    ]
  end)

total_messages = length(g1_messages) + length(g2_messages) + length(dm_messages)
IO.puts("Created #{total_messages} messages (#{length(g1_messages)} in group 1, #{length(g2_messages)} in group 2, #{length(dm_messages)} in DMs)")

# ── 5. Create Reactions ───────────────────────────────────────────────

reactions_spec = [
  # Group 1 reactions
  {Enum.at(g1_messages, 0), "bob", "thumbsup"},
  {Enum.at(g1_messages, 0), "carol", "heart"},
  {Enum.at(g1_messages, 0), "dave", "thumbsup"},
  {Enum.at(g1_messages, 5), "alice", "fire"},
  {Enum.at(g1_messages, 5), "carol", "fire"},
  {Enum.at(g1_messages, 6), "bob", "star"},
  {Enum.at(g1_messages, 6), "dave", "star"},
  {Enum.at(g1_messages, 11), "alice", "heart"},
  {Enum.at(g1_messages, 11), "dave", "eyes"},
  # Group 2 reactions
  {Enum.at(g2_messages, 0), "frank", "wave"},
  {Enum.at(g2_messages, 4), "alice", "heart"},
  {Enum.at(g2_messages, 4), "bob", "fire"},
  {Enum.at(g2_messages, 9), "eve", "thumbsup"},
  {Enum.at(g2_messages, 9), "alice", "thumbsup"},
  {Enum.at(g2_messages, 11), "bob", "heart"},
  {Enum.at(g2_messages, 11), "eve", "star"}
]

for {message, username, reaction_key} <- reactions_spec do
  %MessageReaction{}
  |> MessageReaction.changeset(%{
    message_id: message.id,
    user_id: users[username].user.id,
    reaction_key: reaction_key
  })
  |> Repo.insert!()
end

IO.puts("Created #{length(reactions_spec)} reactions")

# ── 6. Create Media Uploads ───────────────────────────────────────────

media_specs = [
  %{user: "bob", kind: "image", filename: "screenshot.png", content_type: "image/png", size: 245_000},
  %{user: "carol", kind: "image", filename: "team-photo.jpg", content_type: "image/jpeg", size: 1_800_000},
  %{user: "eve", kind: "video", filename: "demo-recording.mp4", content_type: "video/mp4", size: 15_000_000},
  %{user: "alice", kind: "audio", filename: "voice-note.ogg", content_type: "audio/ogg", size: 320_000},
  %{user: "frank", kind: "file", filename: "meeting-notes.pdf", content_type: "application/pdf", size: 89_000},
  %{user: "alice", kind: "image", filename: "whiteboard.png", content_type: "image/png", size: 540_000},
  %{user: "dave", kind: "file", filename: "report-q4.xlsx", content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 120_000}
]

for spec <- media_specs do
  dummy_ciphertext = :crypto.strong_rand_bytes(min(spec.size, 1024))
  sha256 = :crypto.hash(:sha256, dummy_ciphertext) |> Base.encode16(case: :lower)

  %Upload{}
  |> Upload.changeset(%{
    uploader_device_id: users[spec.user].device.id,
    status: "completed",
    media_kind: spec.kind,
    filename: spec.filename,
    content_type: spec.content_type,
    declared_byte_size: spec.size,
    uploaded_byte_size: spec.size,
    expected_part_count: 1,
    ciphertext: dummy_ciphertext,
    ciphertext_sha256: sha256,
    completed_at: now
  })
  |> Repo.insert!()
end

IO.puts("Created #{length(media_specs)} media uploads")

# ── Summary ───────────────────────────────────────────────────────────

IO.puts("""

=== Seed Complete ===

Users:       #{length(users_data)}
Groups:      2 (Project Alpha: 4 members, Weekend Plans: 4 members)
Direct:      #{length(direct_chats)} conversations
Messages:    #{total_messages}
Reactions:   #{length(reactions_spec)}
Media:       #{length(media_specs)} uploads

To authenticate as any user, use:
  curl -H "Authorization: Bearer <token>" http://localhost:4000/api/v1/me
""")
