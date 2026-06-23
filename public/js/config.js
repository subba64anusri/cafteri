// Shared config used by every page. Instead of hardcoding one IP address
// (which broke the app on any other network), this detects the API server
// from the page's own location: same host, fixed port 5000.
// Override by setting window.CANTEEN_API_BASE before this script runs,
// or by editing API_PORT below if your server uses a different port.
(function () {
  const API_PORT = 5000;
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  const host = window.location.hostname || 'localhost';

  if (window.location.hostname === 'cafteri.com' || window.location.hostname === 'www.cafteri.com') {
  window.CANTEEN_API_BASE = window.location.origin;
} else {
  // Fallback for local development
  window.CANTEEN_API_BASE = window.CANTEEN_API_BASE || `${protocol}//${host}:${API_PORT}`;
}
})();
