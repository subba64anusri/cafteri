/* Shared helpers used across all pages: a lightweight session module,
   a fetch wrapper with consistent error handling + auth headers,
   a canteen-aware Socket.IO connector, toast notifications, and formatters. */

// ---------------------------------------------------------------------------
// Session — single source of truth for "who is logged in as what" and
// "which canteen is currently selected". No JWT: we store the identifying
// value (manager username / chef username / student email) and re-send it
// as a header on every request; the server re-validates it against the DB
// every time (see middleware/auth.js).
// ---------------------------------------------------------------------------
const Session = {
  KEYS: {
    manager: 'cafteri_manager_username',
    chef: 'cafteri_chef_username',
    student: 'cafteri_student_email',
    selectedCanteen: 'cafteri_selected_canteen' // { id, name, slug }
  },

  setManager(username) { localStorage.setItem(this.KEYS.manager, username); },
  getManager() { return localStorage.getItem(this.KEYS.manager); },
  clearManager() { localStorage.removeItem(this.KEYS.manager); },

  setChef(username, canteen) {
    localStorage.setItem(this.KEYS.chef, username);
    if (canteen) localStorage.setItem(this.KEYS.selectedCanteen, JSON.stringify(canteen));
  },
  getChef() { return localStorage.getItem(this.KEYS.chef); },
  clearChef() {
    localStorage.removeItem(this.KEYS.chef);
    localStorage.removeItem(this.KEYS.selectedCanteen);
  },

  setStudent(email) { localStorage.setItem(this.KEYS.student, email); },
  getStudent() { return localStorage.getItem(this.KEYS.student); },
  clearStudent() {
    localStorage.removeItem(this.KEYS.student);
    localStorage.removeItem(this.KEYS.selectedCanteen);
  },

  setSelectedCanteen(canteen) { localStorage.setItem(this.KEYS.selectedCanteen, JSON.stringify(canteen)); },
  getSelectedCanteen() {
    const raw = localStorage.getItem(this.KEYS.selectedCanteen);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  },
  clearSelectedCanteen() { localStorage.removeItem(this.KEYS.selectedCanteen); },

  clearAll() {
    Object.values(this.KEYS).forEach(k => localStorage.removeItem(k));
  }
};

function ensureToastStack() {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

function showToast(message, type = 'default') {
  const stack = ensureToastStack();
  const toast = document.createElement('div');
  toast.className = 'toast' + (type === 'error' ? ' toast--error' : '');
  toast.textContent = message;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s ease';
    setTimeout(() => toast.remove(), 220);
  }, 3200);
}

// Wraps fetch with JSON parsing, consistent error shape, and automatic auth
// headers based on whichever session is currently active on this page.
// Throws an Error with a human-readable message on failure.
async function apiFetch(path, options = {}) {
  const base = window.CANTEEN_API_BASE;
  const url = path.startsWith('http') ? path : `${base}${path}`;

  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

  const managerUsername = Session.getManager();
  const chefUsername = Session.getChef();
  const studentEmail = Session.getStudent();
  if (managerUsername) headers['x-manager-username'] = managerUsername;
  if (chefUsername) headers['x-chef-username'] = chefUsername;
  if (studentEmail) headers['x-student-email'] = studentEmail;

  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (networkErr) {
    throw new Error('Could not reach the server. Check that it is running and reachable.');
  }

  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    // Some endpoints (e.g. plain 200 with no body) may not return JSON
  }

  if (!response.ok) {
    const message = (data && data.error) ? data.error : `Request failed (${response.status}).`;
    throw new Error(message);
  }

  return data;
}

// Loads the Socket.IO client library from our own API server instead of a
// public CDN — the socket.io npm package serves this automatically at
// /socket.io/socket.io.js, so nothing external is required. This keeps
// real-time working on closed networks (campus LAN, no internet egress)
// where a CDN request would just hang and time out.
let _socketIoScriptPromise = null;
function loadSocketIoClient() {
  if (typeof io !== 'undefined') return Promise.resolve();
  if (_socketIoScriptPromise) return _socketIoScriptPromise;

  _socketIoScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${window.CANTEEN_API_BASE}/socket.io/socket.io.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the real-time connection script from the server.'));
    document.head.appendChild(script);
  });

  return _socketIoScriptPromise;
}

// Connects to the Socket.IO server and identifies this client's role.
// `canteenId` scopes chef/manager connections to that canteen's kitchen
// room server-side. Returns a Promise resolving to the socket instance (or
// null on failure), and updates any .live-dot elements as connection state
// changes. The returned socket also gets a `.switchCanteen(newId)` helper
// attached, used by the manager dashboard when switching canteens without
// a full reconnect.
async function connectCanteenSocket({ role, email, canteenId } = {}) {
  const setDots = (online) => {
    document.querySelectorAll('.live-dot').forEach(dot => {
      dot.classList.toggle('is-offline', !online);
      const label = dot.querySelector('.live-dot__label');
      if (label) label.textContent = online ? 'Live' : 'Reconnecting…';
    });
  };

  try {
    await loadSocketIoClient();
  } catch (err) {
    console.warn(err.message);
    setDots(false);
    return null;
  }

  const socket = io(window.CANTEEN_API_BASE, { transports: ['websocket', 'polling'] });
  let currentCanteenId = canteenId || null;

  socket.on('connect', () => {
    setDots(true);
    socket.emit('identify', { role, email, canteenId: currentCanteenId });
  });
  socket.on('disconnect', () => setDots(false));
  socket.on('connect_error', () => setDots(false));

  socket.switchCanteen = (newCanteenId) => {
    socket.emit('switch-canteen', { previousCanteenId: currentCanteenId, canteenId: newCanteenId });
    currentCanteenId = newCanteenId;
  };

  return socket;
}

function formatRupees(amount) {
  const value = Number(amount) || 0;
  return `₹${value.toLocaleString('en-IN')}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
