// Holds an open connection to the server for as long as this page lives.
// The server uses it to know whether any window is still open (see
// src/services/idleShutdown.js). EventSource reconnects on its own.
export function keepSessionAlive() {
  if (!window.EventSource) return;
  const source = new EventSource('/api/session');
  source.onerror = () => {};
}
