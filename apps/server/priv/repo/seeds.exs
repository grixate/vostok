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
    {device_pub, device_priv} = generate_keypair.()
    {enc_pub, _enc_priv} = :crypto.generate_key(:ecdh, :prime256v1)
    {spk_pub, _spk_priv} = :crypto.generate_key(:ecdh, :prime256v1)
    signed_prekey = spk_pub
    signed_prekey_sig = :crypto.sign(:eddsa, :none, spk_pub, [device_priv, :ed25519])

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

    # Generate 20 one-time prekeys (ECDH P-256)
    for _i <- 1..20 do
      {otpk_pub, _otpk_priv} = :crypto.generate_key(:ecdh, :prime256v1)

      %OneTimePrekey{}
      |> OneTimePrekey.changeset(%{public_key: otpk_pub})
      |> Ecto.Changeset.put_assoc(:device, device)
      |> Repo.insert!()
    end

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
# Uses message_kind "system" so the client can decode text without E2EE decryption.
insert_message = fn chat, sender_username, _message_kind, minutes_ago, opts ->
  sender = users[sender_username]
  ts = DateTime.add(now, -minutes_ago * 60, :second)
  text = opts[:text] || "Hello"
  ciphertext = text

  attrs = %{
    client_id: Ecto.UUID.generate(),
    ciphertext: ciphertext,
    message_kind: "system",
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
  insert_message.(group1, "alice", "text", 120, %{text: "Hey everyone, just pushed the new auth module. Can you review before EOD?"}),
  insert_message.(group1, "bob", "text", 115, %{text: "On it. Anything specific you want me to focus on?"}),
  insert_message.(group1, "carol", "text", 110, %{text: "I'll check the edge cases around token expiry — that was buggy last sprint."}),
  insert_message.(group1, "alice", "text", 100, %{text: "Yes, especially the refresh logic. And make sure the rate limiting tests pass."}),
  insert_message.(group1, "dave", "text", 95, %{text: "Heads up — CI is red on main right now. Looks like a flaky integration test."}),
  insert_message.(group1, "bob", "text", 90, %{text: "Found it — the test was using a hardcoded port that conflicts. I'll fix."}),
  insert_message.(group1, "alice", "text", 85, %{text: "📌 Sprint goal: ship the auth refactor + logging pipeline before Friday.", pinned: true}),
  insert_message.(group1, "carol", "text", 80, %{text: "Review done. Left 3 comments, mostly minor. LGTM overall 👍"}),
  insert_message.(group1, "dave", "text", 75, %{text: "Merged. Thanks Carol. Deploy to staging in ~10 min."}),
  insert_message.(group1, "alice", "text", 60, %{text: "Staging looks good. Latency is actually down 15ms on the auth endpoints.", edited: true}),
  insert_message.(group1, "bob", "text", 50, %{text: "Nice. Production deploy scheduled for tomorrow 10am UTC. Everyone available to monitor?"}),
  insert_message.(group1, "carol", "text", 40, %{text: "I'll be online. Setting up Grafana alerts now."}),
  insert_message.(group1, "dave", "text", 30, %{text: "Same. I'll keep an eye on the DB connection pool."}),
  insert_message.(group1, "alice", "text", 20, %{text: "Great. Let's do a quick sync at 9:45 before the deploy window."}),
  insert_message.(group1, "bob", "text", 10, %{text: "👋 Just a reminder — standup is async today, drop notes in the thread."}),
]

# Group 2 conversation (Weekend Plans)
g2_messages = [
  insert_message.(group2, "eve", "text", 200, %{text: "Anyone up for hiking this Saturday? Trail conditions look good after the rain."}),
  insert_message.(group2, "frank", "text", 190, %{text: "I'm in! Which trail are you thinking?"}),
  insert_message.(group2, "alice", "text", 180, %{text: "The ridge loop? It's about 12km with good views at the top."}),
  insert_message.(group2, "bob", "text", 170, %{text: "Sounds perfect. What time? Morning start is better before it gets hot."}),
  insert_message.(group2, "eve", "text", 160, %{text: "Let's meet at the trailhead parking lot at 8am. I'll bring snacks."}),
  insert_message.(group2, "frank", "text", 150, %{text: "I can bring coffee and the portable speaker 🎵"}),
  insert_message.(group2, "alice", "text", 140, %{text: "Amazing. I'll pack extra water and a first aid kit just in case."}),
  insert_message.(group2, "eve", "text", 130, %{text: "Frank — remember to bring actual hiking boots this time 😂"}),
  insert_message.(group2, "bob", "text", 120, %{text: "Haha the sandal incident. Still a legend."}),
  insert_message.(group2, "frank", "text", 100, %{text: "📌 Saturday 8am — Ridge loop trailhead. Bring boots. 🥾", pinned: true}),
  insert_message.(group2, "eve", "text", 80, %{text: "Weather forecast looks clear 🌤 Can't wait!"}),
  insert_message.(group2, "alice", "text", 60, %{text: "See you all Saturday! This is going to be a great weekend."}),
]

# Direct chat messages — each pair gets a contextually appropriate conversation
dm_texts = %{
  {"alice", "bob"} => [
    "Hey Bob, did you get a chance to look at the spec I sent over?",
    "Yeah, read it this morning. I have a few questions about the API design.",
    "Sure, shoot. I'm free to chat for the next hour.",
    "The pagination approach — are we going cursor-based or offset?",
    "Cursor-based. Offset doesn't scale well with our data volume.",
    "Makes sense. I'll update my implementation accordingly.",
    "Let me know if you need me to review your PR when it's ready.",
    "Will do. Should be up by end of day. Thanks Alice!"
  ],
  {"alice", "carol"} => [
    "Carol, can you take a look at the load testing results when you get a chance?",
    "Just pulled them up. P99 looks a bit high on the /auth endpoint.",
    "Yeah, we're seeing spikes under concurrent load. Any ideas?",
    "Might be connection pool exhaustion. What's the pool size set to?",
    "20 connections. We might need to bump it.",
    "Try 50 and see if it stabilizes. Also check for any N+1 queries.",
    "Good call — found one in the user sessions query. Fixing now.",
    "Nice catch. Let me know how the next load test goes!"
  ],
  {"bob", "dave"} => [
    "Dave, are you blocked on anything? Haven't seen any commits from you today.",
    "Yeah, the Docker environment is broken. Can't get the db to connect inside the container.",
    "Check your docker-compose.yml — the service name needs to match the DB_HOST env var.",
    "Oh! It was DATABASE_URL pointing to localhost instead of the service name. Fixed.",
    "Classic mistake. Glad it's sorted. What are you working on?",
    "The new import pipeline. Should have a draft PR up tomorrow.",
    "Cool, tag me for review. I know that code well.",
    "Will do. Also — are we doing code review pairing this week?"
  ],
  {"eve", "frank"} => [
    "Frank! Did you see the new design mockups Figma sent over?",
    "Not yet — are they for the dashboard redesign?",
    "Yes! They look really clean. The sidebar especially.",
    "Okay I'm looking now... wow these are nice. Much better than the current layout.",
    "Right? I want to get started on the implementation ASAP.",
    "Let's split it — I can take the sidebar and you do the main content area?",
    "Perfect split. I'll create tickets in Linear.",
    "Sounds like a plan. Let's sync tomorrow morning to align on the approach."
  ],
  {"carol", "eve"} => [
    "Eve, quick question — what's the status on the API documentation?",
    "About 80% done. Just finishing the WebSocket events section.",
    "We need it by Thursday for the partner integration call.",
    "I'll have it done Wednesday evening. Want me to send you a draft first?",
    "Yes please! I'd like to review the auth section especially.",
    "On it. I'll ping you when the draft is ready — probably later today.",
    "Great, thanks Eve. The partners are really excited about this integration.",
    "Me too! It's a solid use case. Talk soon 😊"
  ]
}

dm_messages =
  Enum.flat_map(direct_chats, fn {u1, u2, chat} ->
    key = {u1, u2}
    texts = Map.get(dm_texts, key, [
      "Hey!", "Hi there!", "How's it going?", "Pretty good, thanks.",
      "Working on some interesting stuff.", "Same here.", "Let's catch up soon.", "Definitely!"
    ])

    texts
    |> Enum.with_index()
    |> Enum.map(fn {text, idx} ->
      sender = if rem(idx, 2) == 0, do: u1, else: u2
      minutes_ago = 300 - idx * 30
      insert_message.(chat, sender, "text", minutes_ago, %{text: text})
    end)
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
