// ============================================
// settings.js — Settings page logic
// ============================================

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const COLORS = [
  '#FF6B6B','#FF9F43','#FFD93D','#6BCB77',
  '#4D96FF','#A29BFE','#FF6BFF','#00D2D3',
  '#fd79a8','#55efc4','#74b9ff','#e17055',
];

let currentUser    = null;
let currentProfile = null;
let selectedColor  = null;
let twofaFactorId  = null;

// ── Boot ──────────────────────────────────

async function boot() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { window.location.href = "index.html"; return; }
  currentUser = session.user;

  const { data: profile } = await db
    .from("users").select("*").eq("id", currentUser.id).maybeSingle();

  if (!profile) { window.location.href = "index.html"; return; }
  currentProfile = profile;
  selectedColor  = profile.color;

  renderPreview();
  renderColorGrid();
  populateFields();
  initNotifications();
  await init2FA();
  hideLoading();
}

function hideLoading() {
  const el = document.getElementById("loading");
  el.classList.add("hidden");
  setTimeout(() => el.remove(), 400);
}

// ── Preview ───────────────────────────────

function renderPreview() {
  const avatar = document.getElementById("preview-avatar");
  avatar.style.background = currentProfile.color;
  avatar.textContent = currentProfile.name.slice(0, 2).toUpperCase();
  document.getElementById("preview-name").textContent = currentProfile.name;
  document.getElementById("preview-hash").textContent = `#${currentProfile.hash}`;
}

function updatePreview() {
  const nameInput = document.getElementById("name-input").value.trim() || currentProfile.name;
  const avatar    = document.getElementById("preview-avatar");
  avatar.style.background = selectedColor;
  avatar.textContent = nameInput.slice(0, 2).toUpperCase();
  document.getElementById("preview-name").textContent = nameInput;
}

// ── Fields ────────────────────────────────

function populateFields() {
  document.getElementById("name-input").value = currentProfile.name;
  document.getElementById("name-input").addEventListener("input", updatePreview);
}

// ── Color grid ────────────────────────────

function renderColorGrid() {
  const grid = document.getElementById("color-grid");
  grid.innerHTML = "";
  COLORS.forEach(color => {
    const swatch = document.createElement("button");
    swatch.className = "color-swatch" + (color === selectedColor ? " selected" : "");
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener("click", () => {
      document.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("selected"));
      swatch.classList.add("selected");
      selectedColor = color;
      updatePreview();
      saveColor(color);
    });
    grid.appendChild(swatch);
  });
}

async function saveColor(color) {
  const status = document.getElementById("color-status");
  const { error } = await db
    .from("users").update({ color }).eq("id", currentUser.id);
  if (error) {
    setStatus("color-status", `// ${error.message}`, "error");
  } else {
    currentProfile.color = color;
    setStatus("color-status", "// saved", "success");
    clearStatusAfter("color-status");
  }
}

// ── Name ──────────────────────────────────

document.getElementById("name-save").addEventListener("click", async () => {
  const name = document.getElementById("name-input").value.trim();
  if (!name) { setStatus("name-status", "// name can't be empty", "error"); return; }

  const btn = document.getElementById("name-save");
  btn.disabled = true;

  const { error } = await db
    .from("users").update({ name }).eq("id", currentUser.id);

  btn.disabled = false;

  if (error) {
    setStatus("name-status", `// ${error.message}`, "error");
  } else {
    currentProfile.name = name;
    renderPreview();
    setStatus("name-status", "// saved", "success");
    clearStatusAfter("name-status");
  }
});

// ── Password ──────────────────────────────

document.getElementById("pw-save").addEventListener("click", async () => {
  const pw  = document.getElementById("pw-input").value;
  if (pw.length < 6) {
    setStatus("pw-status", "// min. 6 characters", "error");
    return;
  }

  const btn = document.getElementById("pw-save");
  btn.disabled = true;

  const { error } = await db.auth.updateUser({ password: pw });
  btn.disabled = false;

  if (error) {
    setStatus("pw-status", `// ${error.message.toLowerCase()}`, "error");
  } else {
    document.getElementById("pw-input").value = "";
    setStatus("pw-status", "// password updated", "success");
    clearStatusAfter("pw-status");
  }
});

// ── Notifications ─────────────────────────

function initNotifications() {
  const toggle   = document.getElementById("notif-toggle");
  const label    = document.getElementById("notif-label");
  const sublabel = document.getElementById("notif-sublabel");

  if (!("Notification" in window)) {
    label.textContent    = "not supported";
    sublabel.textContent = "your browser doesn't support notifications";
    toggle.disabled = true;
    return;
  }

  function updateNotifUI() {
    const perm = Notification.permission;
    if (perm === "granted") {
      toggle.classList.add("on");
      label.textContent    = "enabled";
      sublabel.textContent = "you'll get notified when messages arrive";
    } else if (perm === "denied") {
      toggle.classList.remove("on");
      label.textContent    = "blocked";
      sublabel.textContent = "unblock in browser site settings to re-enable";
    } else {
      toggle.classList.remove("on");
      label.textContent    = "disabled";
      sublabel.textContent = "click to request permission";
    }
  }

  updateNotifUI();

  toggle.addEventListener("click", async () => {
    const perm = Notification.permission;
    if (perm === "denied") {
      sublabel.textContent = "// open browser settings → site permissions to unblock";
      return;
    }
    if (perm === "granted") {
      // Can't programmatically revoke — just inform user
      sublabel.textContent = "// revoke in browser site settings if you want to disable";
      return;
    }
    // default — request
    const result = await Notification.requestPermission();
    updateNotifUI();
  });
}

// ── 2FA ───────────────────────────────────

async function init2FA() {
  const toggle  = document.getElementById("twofa-toggle");
  const label   = document.getElementById("twofa-label");
  const qrWrap  = document.getElementById("qr-wrap");
  const status  = document.getElementById("twofa-toggle-status");

  // Check existing factors
  try {
    const { data, error } = await db.auth.mfa.listFactors();
    if (error) throw error;

    const totpFactor = data?.totp?.[0];

    if (totpFactor && totpFactor.status === "verified") {
      twofaFactorId = totpFactor.id;
      toggle.classList.add("on");
      label.textContent = "enabled";
    } else {
      toggle.classList.remove("on");
      label.textContent = "disabled";
    }
  } catch (e) {
    label.textContent = "unavailable";
    setStatus("twofa-toggle-status", "// enable MFA in Supabase dashboard → Auth → MFA", "warning");
    toggle.disabled = true;
    return;
  }

  toggle.addEventListener("click", async () => {
    if (toggle.classList.contains("on")) {
      // Disable 2FA
      if (!twofaFactorId) return;
      const { error } = await db.auth.mfa.unenroll({ factorId: twofaFactorId });
      if (error) {
        setStatus("twofa-toggle-status", `// ${error.message.toLowerCase()}`, "error");
        return;
      }
      toggle.classList.remove("on");
      label.textContent = "disabled";
      twofaFactorId = null;
      qrWrap.classList.remove("visible");
      setStatus("twofa-toggle-status", "// 2fa disabled", "success");
      clearStatusAfter("twofa-toggle-status");
    } else {
      // Enroll 2FA — show QR
      await start2FAEnrollment();
    }
  });

  // Verify TOTP code
  document.getElementById("totp-verify").addEventListener("click", async () => {
    const code = document.getElementById("totp-code").value.trim();
    if (!code || code.length !== 6) {
      setStatus("twofa-status", "// enter 6-digit code", "error");
      return;
    }
    await verify2FA(code);
  });
}

async function start2FAEnrollment() {
  const qrWrap  = document.getElementById("qr-wrap");
  const status  = document.getElementById("twofa-status");

  try {
    const { data, error } = await db.auth.mfa.enroll({ factorType: "totp" });
    if (error) throw error;

    twofaFactorId = data.id;

    // Show QR
    document.getElementById("qr-img").src = data.totp.qr_code;
    document.getElementById("qr-secret").textContent = `manual: ${data.totp.secret}`;
    qrWrap.classList.add("visible");
    setStatus("twofa-status", "// scan with authenticator app, then enter code below", "warning");
  } catch (e) {
    setStatus("twofa-toggle-status", `// ${e.message?.toLowerCase() ?? "error enrolling"}`, "error");
  }
}

async function verify2FA(code) {
  const label  = document.getElementById("twofa-label");
  const toggle = document.getElementById("twofa-toggle");
  const qrWrap = document.getElementById("qr-wrap");
  const status = document.getElementById("twofa-status");

  try {
    const { data: challengeData, error: challengeErr } = await db.auth.mfa.challenge({ factorId: twofaFactorId });
    if (challengeErr) throw challengeErr;

    const { error: verifyErr } = await db.auth.mfa.verify({
      factorId:    twofaFactorId,
      challengeId: challengeData.id,
      code,
    });
    if (verifyErr) throw verifyErr;

    toggle.classList.add("on");
    label.textContent = "enabled";
    qrWrap.classList.remove("visible");
    document.getElementById("totp-code").value = "";
    setStatus("twofa-toggle-status", "// 2fa enabled", "success");
    clearStatusAfter("twofa-toggle-status");
  } catch (e) {
    setStatus("twofa-status", `// ${e.message?.toLowerCase() ?? "invalid code"}`, "error");
  }
}

// ── Delete account ────────────────────────

document.getElementById("delete-btn").addEventListener("click", () => {
  document.getElementById("confirm-overlay").classList.add("visible");
});

document.getElementById("confirm-cancel").addEventListener("click", () => {
  document.getElementById("confirm-overlay").classList.remove("visible");
});

document.getElementById("confirm-delete").addEventListener("click", async () => {
  const btn = document.getElementById("confirm-delete");
  btn.disabled = true;
  btn.textContent = "deleting...";

  // Delete messages
  await db.from("messages").delete().eq("user_id", currentUser.id);
  // Delete room memberships
  await db.from("room_members").delete().eq("user_id", currentUser.id);
  // Delete user profile
  await db.from("users").delete().eq("id", currentUser.id);
  // Delete auth account (requires service role — falls back to sign out)
  const { error } = await db.auth.admin?.deleteUser?.(currentUser.id);

  // Sign out regardless
  await db.auth.signOut();
  window.location.href = "index.html";
});

// ── Helpers ───────────────────────────────

function setStatus(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `row-status ${type}`;
}

function clearStatusAfter(id, ms = 2500) {
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ""; el.className = "row-status empty"; }
  }, ms);
}

// ── Go ────────────────────────────────────
boot();