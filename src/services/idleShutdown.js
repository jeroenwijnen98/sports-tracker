// Keeps the server alive only while a browser window is actually open.
//
// Each page holds an SSE connection to /api/session. Unlike a polling
// heartbeat, an open connection is not throttled when the tab is in the
// background, and it drops the instant the tab closes. When the last
// connection goes away the process exits, so closing the window really
// does return to zero RAM.
//
// Only active when SPORTS_AUTOQUIT=1 (set by SportsTracker.app). Running
// `node server.js` by hand keeps the server up as before.

const GRACE_MS = 15_000;         // survive a page reload
const STARTUP_GRACE_MS = 60_000; // in case the browser never connects
const AUTH_HOLD_MS = 300_000;    // the Polar OAuth round trip
const PING_MS = 25_000;

export function attachIdleShutdown(app, { enabled }) {
  let clients = 0;
  let timer = null;
  let holdUntil = 0;

  const scheduleQuit = (ms) => {
    clearTimeout(timer);
    if (!enabled) return;
    timer = setTimeout(() => {
      if (clients > 0) return;
      // A hold outlives the timer that was already ticking when it was set,
      // so re-check it here rather than at schedule time.
      const remaining = holdUntil - Date.now();
      if (remaining > 0) return scheduleQuit(remaining);
      console.log('No open windows — shutting down.');
      process.exit(0);
    }, ms);
  };

  // While the user is logging in there is no window open at all: the browser
  // sits on flow.polar.com and only returns to /auth/callback. Without this
  // hold the server would quit those 15 seconds later and the callback would
  // arrive at a dead port.
  app.use('/auth', (req, res, next) => {
    holdUntil = Date.now() + AUTH_HOLD_MS;
    next();
  });

  app.get('/api/session', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    clients += 1;
    clearTimeout(timer);

    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
    req.on('close', () => {
      clearInterval(ping);
      clients -= 1;
      if (clients <= 0) scheduleQuit(GRACE_MS);
    });
  });

  scheduleQuit(STARTUP_GRACE_MS);
}
