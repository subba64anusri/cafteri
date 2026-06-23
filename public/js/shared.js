/* Shared helpers used across all pages: toast notifications, a fetch
   wrapper with consistent error handling, and a Socket.IO connector. */
if (!window.CANTEEN_API_BASE || window.CANTEEN_API_BASE.includes('localhost')) {
  window.CANTEEN_API_BASE = window.location.origin;
}


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

// Wraps fetch with JSON parsing and a consistent error shape.
// Throws an Error with a human-readable message on failure.
async function apiFetch(path, options = {}) {
  const base = window.CANTEEN_API_BASE;
  const url = path.startsWith('http') ? path : `${base}${path}`;

  let response;
  try {
    response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
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
// Returns a Promise resolving to the socket instance (or null on failure),
// and updates any .live-dot elements on the page as connection state changes.
async function connectCanteenSocket({ role, email } = {}) {
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

  socket.on('connect', () => {
    setDots(true);
    socket.emit('identify', { role, email });
  });
  socket.on('disconnect', () => setDots(false));
  socket.on('connect_error', () => setDots(false));

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