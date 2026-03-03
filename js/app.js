// ============================================
// app.js — Main chat logic
// ============================================

const db = window.db.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── State ─────────────────────────────────
let currentUser     = null;   // auth user
let currentProfile  = null;   // users table row
let currentRoomId   = null;   // active room
let replyToMsg      = null;   // message being replied to
let msgSubscription = null;   // realtime sub
let allRooms        = [];     // public rooms
let allDMs          = [];     // dm rooms

// ── Boot ──────────────────────────────────

async function boot() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { window.location.href = "index.html"; return; }

  currentUser = session.user;

  // Load own profile
  const { data: profile } = await db
    .from("users")
    .select("*")
    .eq("id", currentUser.id)
    .single();

  if (!profile) { window.location.href = "index.html"; return; }
  currentProfile = profile;

  renderUserFooter();
  await loadSidebar();
  Notifications.init();
  hideLoading();
}

// ── UI helpers ────────────────────────────

function hideLoading() {
  const el = document.getElementById("loading");
  el.classList.add("hidden");
  setTimeout(() => el.remove(), 400);
}

function renderUserFooter() {
  const avatar = document.getElementById("user-avatar");
  const hash   = document.getElementById("user-hash");
  avatar.style.background = currentProfile.color;
  avatar.textContent = currentProfile.name.slice(0, 2).toUpperCase();
  hash.textContent = currentProfile.hash;
}

function makeAvatar(profile) {
  const el = document.createElement("div");
  el.className = "msg-avatar";
  el.style.background = profile.color;
  el.textContent = profile.name.slice(0, 2).toUpperCase();
  return el;
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isSameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.toDateString() === db.toDateString();
}

// ── Sidebar ───────────────────────────────

async function loadSidebar() {
  // Load public rooms user is a member of + auto-join general
  await ensureGeneralMembership();

  const { data: memberRooms } = await db
    .from("room_members")
    .select("room_id, rooms(*)")
    .eq("user_id", currentUser.id)
    .is("left_at", null);

  if (!memberRooms) return;

  allRooms = memberRooms.filter(r => !r.rooms.is_dm).map(r => r.rooms);
  allDMs   = memberRooms.filter(r => r.rooms.is_dm).map(r => r.rooms);

  renderRoomList();
  renderDMList();
}

async function ensureGeneralMembership() {
  const generalId = "00000000-0000-0000-0000-000000000001";
  const { data } = await db
    .from("room_members")
    .select("room_id")
    .eq("room_id", generalId)
    .eq("user_id", currentUser.id)
    .single();

  if (!data) {
    await db.from("room_members").insert({
      room_id: generalId,
      user_id: currentUser.id,
    });
  }
}

function renderRoomList() {
  const list = document.getElementById("room-list");
  list.innerHTML = "";
  allRooms.forEach(room => {
    const item = document.createElement("div");
    item.className = "room-item" + (room.id === currentRoomId ? " active" : "");
    item.dataset.id = room.id;
    item.innerHTML = `<span class="room-prefix">#</span><span>${room.name}</span>`;
    item.addEventListener("click", () => openRoom(room));
    list.appendChild(item);
  });
}

function renderDMList() {
  const list = document.getElementById("dm-list");
  list.innerHTML = "";
  allDMs.forEach(room => {
    const item = document.createElement("div");
    item.className = "room-item" + (room.id === currentRoomId ? " active" : "");
    item.dataset.id = room.id;
    // DM room name is stored as "hash1 · hash2"
    const label = room.name.replace(currentProfile.hash, "").replace("·", "").trim();
    item.innerHTML = `<span class="room-prefix">@</span><span>${label}</span>`;
    item.addEventListener("click", () => openRoom(room));
    list.appendChild(item);
  });
}

// ── Open Room ─────────────────────────────

async function openRoom(room) {
  currentRoomId = room.id;
  replyToMsg = null;
  Notifications.clearUnread();

  // Update sidebar active state
  document.querySelectorAll(".room-item").forEach(el => {
    el.classList.toggle("active", el.dataset.id === room.id);
  });

  // Build chat UI
  const main = document.getElementById("main");
  main.innerHTML = `
    <div class="chat-header">
      <span class="chat-header-prefix">${room.is_dm ? "@" : "#"}</span>
      <span class="chat-header-name">${room.is_dm
        ? room.name.replace(currentProfile.hash, "").replace("·", "").trim()
        : room.name
      }</span>
      ${room.description ? `<span class="chat-header-desc">${room.description}</span>` : ""}
    </div>
    <div class="messages" id="messages"></div>
    <div class="input-area">
      <div class="input-wrap" id="input-wrap">
        <div class="reply-preview" id="reply-preview">
          <span id="reply-text"></span>
          <button class="reply-cancel" id="reply-cancel">✕</button>
        </div>
        <div class="input-inner">
          <textarea id="msg-input" placeholder="// message ${room.is_dm ? "" : "#"}${room.name}" rows="1"></textarea>
          <button class="send-btn" id="send-btn">send</button>
        </div>
      </div>
    </div>
  `;

  setupInputHandlers();
  await loadMessages();
  subscribeToRoom(room.id);
}

// ── Messages ──────────────────────────────

async function loadMessages() {
  const { data: messages } = await db
    .from("messages")
    .select("*, users(*)")
    .eq("room_id", currentRoomId)
    .order("timestamp", { ascending: true })
    .limit(100);

  const container = document.getElementById("messages");
  if (!messages || messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-big">//</div>
        <div>no messages yet</div>
        <div style="color:var(--text-muted)">be the first</div>
      </div>`;
    return;
  }

  container.innerHTML = "";
  let lastUserId = null;
  let lastTimestamp = null;

  for (const msg of messages) {
    const collapsed = lastUserId === msg.user_id &&
      lastTimestamp && (new Date(msg.timestamp) - new Date(lastTimestamp)) < 5 * 60 * 1000;
    container.appendChild(await buildMsgEl(msg, collapsed));
    lastUserId = msg.user_id;
    lastTimestamp = msg.timestamp;
  }

  scrollToBottom();
}

async function buildMsgEl(msg, collapsed = false) {
  const el = document.createElement("div");
  el.className = "msg" + (collapsed ? " collapsed" : "");
  el.dataset.id = msg.id;

  const profile = msg.users || { name: "?", color: "#333", hash: "unknown#0000" };

  // Reply context
  let replyHTML = "";
  if (msg.reply_id) {
    const { data: replied } = await db
      .from("messages")
      .select("content, users(hash)")
      .eq("id", msg.reply_id)
      .single();
    if (replied) {
      replyHTML = `<div class="msg-reply">↩ ${replied.users?.hash ?? "?"}: ${replied.content.slice(0, 60)}${replied.content.length > 60 ? "…" : ""}</div>`;
    }
  }

  el.innerHTML = `
    <div class="msg-avatar" style="background:${profile.color}">${profile.name.slice(0,2).toUpperCase()}</div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-name" style="color:${profile.color}">${profile.hash}</span>
        <span class="msg-time">${formatTime(msg.timestamp)}</span>
      </div>
      ${replyHTML}
      <div class="msg-text">${escapeHTML(msg.content)}</div>
    </div>
  `;

  // Right-click to reply
  el.addEventListener("contextmenu", e => {
    e.preventDefault();
    setReply(msg);
  });

  return el;
}

function escapeHTML(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

function scrollToBottom() {
  const container = document.getElementById("messages");
  if (container) container.scrollTop = container.scrollHeight;
}

// ── Realtime ──────────────────────────────

function subscribeToRoom(roomId) {
  if (msgSubscription) db.removeChannel(msgSubscription);

  msgSubscription = db
    .channel(`room-${roomId}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `room_id=eq.${roomId}`,
    }, async payload => {
      // Fetch full message with user
      const { data: msg } = await db
        .from("messages")
        .select("*, users(*)")
        .eq("id", payload.new.id)
        .single();

      if (!msg) return;

      const container = document.getElementById("messages");
      if (!container) return;

      // Fire notification if message is from someone else
      if (msg.user_id !== currentUser.id) {
        const room = allRooms.find(r => r.id === roomId) || allDMs.find(r => r.id === roomId);
        Notifications.notify({
          senderHash:  msg.users?.hash  ?? "unknown",
          senderColor: msg.users?.color ?? "#ffffff",
          content:     msg.content,
          roomName:    room?.name ?? "unknown",
          isDM:        room?.is_dm ?? false,
        });
      }

      // Remove empty state if present
      const emptyState = container.querySelector(".empty-state");
      if (emptyState) emptyState.remove();

      // Collapse if same user within 5 min
      const msgs = container.querySelectorAll(".msg:not(.collapsed)");
      const lastMsg = msgs[msgs.length - 1];
      let collapsed = false;

      if (lastMsg) {
        const lastId = lastMsg.dataset.id;
        const { data: lastData } = await db
          .from("messages")
          .select("user_id, timestamp")
          .eq("id", lastId)
          .single();
        if (lastData &&
            lastData.user_id === msg.user_id &&
            (new Date(msg.timestamp) - new Date(lastData.timestamp)) < 5 * 60 * 1000) {
          collapsed = true;
        }
      }

      const el = await buildMsgEl(msg, collapsed);
      container.appendChild(el);
      scrollToBottom();
    })
    .subscribe();
}

// ── Send message ──────────────────────────

async function sendMessage() {
  const input = document.getElementById("msg-input");
  if (!input) return;
  const content = input.value.trim();
  if (!content) return;

  const btn = document.getElementById("send-btn");
  btn.disabled = true;

  const { error } = await db.from("messages").insert({
    room_id:  currentRoomId,
    user_id:  currentUser.id,
    content,
    reply_id: replyToMsg?.id ?? null,
  });

  if (!error) {
    input.value = "";
    input.style.height = "auto";
    clearReply();
  }

  btn.disabled = false;
  input.focus();
}

// ── Reply ─────────────────────────────────

function setReply(msg) {
  replyToMsg = msg;
  const preview = document.getElementById("reply-preview");
  const text    = document.getElementById("reply-text");
  if (!preview || !text) return;
  preview.classList.add("visible");
  text.textContent = `↩ replying to ${msg.users?.hash ?? "?"}: ${msg.content.slice(0, 40)}${msg.content.length > 40 ? "…" : ""}`;
}

function clearReply() {
  replyToMsg = null;
  const preview = document.getElementById("reply-preview");
  if (preview) preview.classList.remove("visible");
}

// ── Input handlers ────────────────────────

function setupInputHandlers() {
  const input  = document.getElementById("msg-input");
  const btn    = document.getElementById("send-btn");
  const cancel = document.getElementById("reply-cancel");

  btn.addEventListener("click", sendMessage);
  cancel?.addEventListener("click", clearReply);

  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  });
}

// ── Create Room ───────────────────────────

document.getElementById("new-room-btn").addEventListener("click", () => {
  document.getElementById("room-modal").classList.add("visible");
  document.getElementById("room-name-input").focus();
});

document.getElementById("room-modal-cancel").addEventListener("click", () => {
  document.getElementById("room-modal").classList.remove("visible");
  document.getElementById("room-name-input").value = "";
  document.getElementById("room-desc-input").value = "";
  document.getElementById("room-modal-status").textContent = "";
});

document.getElementById("room-modal-create").addEventListener("click", async () => {
  const name = document.getElementById("room-name-input").value.trim().toLowerCase().replace(/\s+/g, "-");
  const desc = document.getElementById("room-desc-input").value.trim();
  const status = document.getElementById("room-modal-status");

  if (!name) { status.textContent = "// name required"; return; }

  const { data: room, error } = await db
    .from("rooms")
    .insert({ name, description: desc || null, is_dm: false })
    .select()
    .single();

  if (error) { status.textContent = `// ${error.message}`; return; }

  // Join the room
  await db.from("room_members").insert({ room_id: room.id, user_id: currentUser.id });

  allRooms.push(room);
  renderRoomList();
  document.getElementById("room-modal-cancel").click();
  openRoom(room);
});

// ── New DM ────────────────────────────────

document.getElementById("new-dm-btn").addEventListener("click", () => {
  document.getElementById("dm-modal").classList.add("visible");
  document.getElementById("dm-hash-input").focus();
});

document.getElementById("dm-modal-cancel").addEventListener("click", () => {
  document.getElementById("dm-modal").classList.remove("visible");
  document.getElementById("dm-hash-input").value = "";
  document.getElementById("dm-modal-status").textContent = "";
});

document.getElementById("dm-modal-open").addEventListener("click", async () => {
  const hash   = document.getElementById("dm-hash-input").value.trim();
  const status = document.getElementById("dm-modal-status");

  if (!hash) { status.textContent = "// enter a hash"; return; }
  if (hash === currentProfile.hash) { status.textContent = "// that's you, bestie"; return; }

  // Find the target user
  const { data: target } = await db
    .from("users")
    .select("*")
    .eq("hash", hash)
    .single();

  if (!target) { status.textContent = "// user not found"; return; }

  // Check if DM room already exists between these two users
  const { data: existing } = await db
    .from("room_members")
    .select("room_id, rooms!inner(is_dm)")
    .eq("user_id", currentUser.id)
    .eq("rooms.is_dm", true);

  if (existing) {
    for (const row of existing) {
      const { data: members } = await db
        .from("room_members")
        .select("user_id")
        .eq("room_id", row.room_id);
      const ids = members.map(m => m.user_id);
      if (ids.includes(target.id) && ids.length === 2) {
        // Already exists, just open it
        const { data: existingRoom } = await db
          .from("rooms")
          .select("*")
          .eq("id", row.room_id)
          .single();
        document.getElementById("dm-modal-cancel").click();
        if (!allDMs.find(r => r.id === existingRoom.id)) {
          allDMs.push(existingRoom);
          renderDMList();
        }
        openRoom(existingRoom);
        return;
      }
    }
  }

  // Create new DM room
  const dmName = `${currentProfile.hash} · ${target.hash}`;
  const { data: room, error } = await db
    .from("rooms")
    .insert({ name: dmName, is_dm: true })
    .select()
    .single();

  if (error) { status.textContent = `// ${error.message}`; return; }

  // Add both members
  await db.from("room_members").insert([
    { room_id: room.id, user_id: currentUser.id },
    { room_id: room.id, user_id: target.id },
  ]);

  allDMs.push(room);
  renderDMList();
  document.getElementById("dm-modal-cancel").click();
  openRoom(room);
});

// ── Sign out ──────────────────────────────

document.getElementById("signout-btn").addEventListener("click", async () => {
  await db.auth.signOut();
  window.location.href = "index.html";
});

// ── Close modals on overlay click ─────────

document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", e => {
    if (e.target === overlay) overlay.querySelector(".modal-btn.secondary").click();
  });
});

// ── Go ────────────────────────────────────
boot();