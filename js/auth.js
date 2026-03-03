// ============================================
// auth.js — Login & Signup
// ============================================

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Redirect if already logged in
db.auth.getSession().then(({ data: { session } }) => {
  if (session) window.location.href = "app.html";
});

// ── Tab switching ──────────────────────────

const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".form-panel");

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    panels.forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add("active");
    clearStatuses();
  });
});

// ── Helpers ────────────────────────────────

function setStatus(id, message, type) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.className = `status ${type}`;
}

function clearStatuses() {
  ["login-status", "signup-status"].forEach(id => {
    const el = document.getElementById(id);
    el.textContent = "";
    el.className = "status empty";
  });
}

function setLoading(btnId, loading) {
  document.getElementById(btnId).disabled = loading;
}

// ── Login ──────────────────────────────────

document.getElementById("login-btn").addEventListener("click", async () => {
  const email    = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  if (!email || !password) {
    setStatus("login-status", "// fill in both fields", "error");
    return;
  }

  setLoading("login-btn", true);
  setStatus("login-status", "// signing in...", "");

  const { error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    setStatus("login-status", `// ${error.message.toLowerCase()}`, "error");
    setLoading("login-btn", false);
    return;
  }

  setStatus("login-status", "// welcome back", "success");
  setTimeout(() => window.location.href = "app.html", 600);
});

// ── Signup ─────────────────────────────────

document.getElementById("signup-btn").addEventListener("click", async () => {
  const email    = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;

  if (!email || !password) {
    setStatus("signup-status", "// fill in both fields", "error");
    return;
  }

  if (password.length < 6) {
    setStatus("signup-status", "// password must be 6+ characters", "error");
    return;
  }

  setLoading("signup-btn", true);
  setStatus("signup-status", "// creating your account...", "");

  const { error } = await db.auth.signUp({ email, password });

  if (error) {
    setStatus("signup-status", `// ${error.message.toLowerCase()}`, "error");
    setLoading("signup-btn", false);
    return;
  }

  setStatus("signup-status", "// account created. signing you in...", "success");
  setTimeout(() => window.location.href = "app.html", 1200);
});

// ── Enter key support ──────────────────────

document.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const activePanel = document.querySelector(".form-panel.active").id;
  if (activePanel === "panel-login")  document.getElementById("login-btn").click();
  if (activePanel === "panel-signup") document.getElementById("signup-btn").click();
});