// ============================================
// notifications.js — Toast, Tab Badge, OS
// ============================================

const Notifications = (() => {

  // ── State ────────────────────────────────
  let unreadCount    = 0;
  let toastQueue     = [];
  let toastShowing   = false;
  let permissionState = "default"; // default | granted | denied

  // ── Init ─────────────────────────────────

  function init() {
    injectStyles();
    injectToastContainer();
    requestPermission();
  }

  async function requestPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      permissionState = "granted";
      return;
    }
    if (Notification.permission === "denied") {
      permissionState = "denied";
      return;
    }
    // Ask on first interaction so browser doesn't block it
    const permission = await Notification.requestPermission();
    permissionState = permission;
  }

  // ── Main entry point ──────────────────────
  // Call this whenever a new message arrives

  function notify({ senderHash, senderColor, content, roomName, isDM }) {
    const isTabVisible = document.visibilityState === "visible";

    // Always increment unread if tab not visible
    if (!isTabVisible) {
      unreadCount++;
      updateTabTitle();
    }

    // OS notification if tab is not visible
    if (!isTabVisible && permissionState === "granted") {
      fireOSNotification({ senderHash, senderColor, content, roomName, isDM });
    }

    // Toast if tab IS visible and it's not the current room
    if (isTabVisible) {
      showToast({ senderHash, senderColor, content, roomName, isDM });
    }
  }

  // Reset unread (call when tab becomes visible or user opens a room)
  function clearUnread() {
    unreadCount = 0;
    updateTabTitle();
  }

  // ── Tab title badge ───────────────────────

  function updateTabTitle() {
    const base = "chat";
    document.title = unreadCount > 0 ? `(${unreadCount}) ${base}` : base;
  }

  // ── OS Notification ───────────────────────

  function fireOSNotification({ senderHash, content, roomName, isDM }) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const title = isDM ? senderHash : `#${roomName}`;
    const body  = isDM ? content : `${senderHash}: ${content}`;

    const notif = new Notification(title, {
      body: body.length > 80 ? body.slice(0, 80) + "…" : body,
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%23080808'/><circle cx='16' cy='16' r='5' fill='white'/></svg>",
      tag:  roomName, // collapses multiple from same room
      silent: false,
    });

    notif.onclick = () => {
      window.focus();
      notif.close();
    };

    // Auto-close after 5s
    setTimeout(() => notif.close(), 5000);
  }

  // ── Toast ─────────────────────────────────

  function showToast({ senderHash, senderColor, content, roomName, isDM }) {
    toastQueue.push({ senderHash, senderColor, content, roomName, isDM });
    if (!toastShowing) processToastQueue();
  }

  function processToastQueue() {
    if (toastQueue.length === 0) { toastShowing = false; return; }
    toastShowing = true;
    const item = toastQueue.shift();
    renderToast(item);
  }

  function renderToast({ senderHash, senderColor, content, roomName, isDM }) {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "toast";

    const initials = senderHash.split("#")[0].slice(0, 2).toUpperCase();
    const preview  = content.length > 55 ? content.slice(0, 55) + "…" : content;
    const label    = isDM ? senderHash : `#${roomName}`;

    toast.innerHTML = `
      <div class="toast-avatar" style="background:${senderColor}">${initials}</div>
      <div class="toast-body">
        <div class="toast-header">
          <span class="toast-name" style="color:${senderColor}">${senderHash}</span>
          <span class="toast-room">${label}</span>
        </div>
        <div class="toast-content">${escapeToast(preview)}</div>
      </div>
      <button class="toast-close">✕</button>
    `;

    // Dismiss
    let dismissTimer;
    const dismiss = () => {
      clearTimeout(dismissTimer);
      toast.classList.add("toast-out");
      toast.addEventListener("animationend", () => {
        toast.remove();
        setTimeout(processToastQueue, 100);
      }, { once: true });
    };

    toast.querySelector(".toast-close").addEventListener("click", dismiss);
    dismissTimer = setTimeout(dismiss, 4000);

    container.appendChild(toast);

    // Trigger entrance animation
    requestAnimationFrame(() => toast.classList.add("toast-in"));
  }

  function escapeToast(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ── DOM injection ─────────────────────────

  function injectToastContainer() {
    if (document.getElementById("toast-container")) return;
    const el = document.createElement("div");
    el.id = "toast-container";
    document.body.appendChild(el);
  }

  function injectStyles() {
    if (document.getElementById("notif-styles")) return;
    const style = document.createElement("style");
    style.id = "notif-styles";
    style.textContent = `
      #toast-container {
        position: fixed;
        bottom: 1.5rem;
        right: 1.5rem;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        pointer-events: none;
      }

      .toast {
        pointer-events: all;
        display: flex;
        align-items: flex-start;
        gap: 0.65rem;
        background: #111111;
        border: 1px solid #222222;
        border-radius: 2px;
        padding: 0.75rem 0.85rem;
        width: 300px;
        opacity: 0;
        transform: translateY(8px);
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      }

      .toast-in {
        animation: toastIn 0.2s ease forwards;
      }

      .toast-out {
        animation: toastOut 0.18s ease forwards;
      }

      @keyframes toastIn {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      @keyframes toastOut {
        from { opacity: 1; transform: translateY(0); }
        to   { opacity: 0; transform: translateY(4px); }
      }

      .toast-avatar {
        width: 24px;
        height: 24px;
        border-radius: 2px;
        flex-shrink: 0;
        font-family: 'DM Mono', monospace;
        font-size: 0.58rem;
        font-weight: 500;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #080808;
      }

      .toast-body {
        flex: 1;
        min-width: 0;
      }

      .toast-header {
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
        margin-bottom: 0.2rem;
      }

      .toast-name {
        font-family: 'DM Mono', monospace;
        font-size: 0.68rem;
        font-weight: 500;
      }

      .toast-room {
        font-family: 'DM Mono', monospace;
        font-size: 0.6rem;
        color: #444;
      }

      .toast-content {
        font-family: 'DM Sans', sans-serif;
        font-size: 0.78rem;
        font-weight: 300;
        color: #aaaaaa;
        line-height: 1.4;
        word-break: break-word;
      }

      .toast-close {
        background: none;
        border: none;
        color: #333;
        cursor: pointer;
        font-size: 0.65rem;
        padding: 0;
        flex-shrink: 0;
        line-height: 1;
        transition: color 0.15s;
        margin-top: 1px;
      }

      .toast-close:hover { color: #ff4444; }
    `;
    document.head.appendChild(style);
  }

  // ── Visibility change → clear unread ─────
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") clearUnread();
  });

  // ── Public API ────────────────────────────
  return { init, notify, clearUnread, requestPermission };

})();