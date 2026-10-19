## Context

`GLOSSARY.md`'s vocabulary: exercise, running sport, overlap, detail data, lap, trackpoint,
route, heart rate sensor, smoothness.

You are in a sandbox, not on the Mac that runs Sports Tracker. There is no `.env`, no Polar
token and no `src/data/`: never call the Polar API, never run `scripts/sync.ts` or the OAuth
flow. The .app launcher, `install-app.command`, `run.sh` and sleepwatcher cannot be exercised
here either; edit them if the issue asks, but you cannot run them.

## Execution

Add tests for pure logic you change; see the Tests section of `CLAUDE.md`.

Frontend files in `public/` are served to the browser as they are: never add a build step, a
bundler or emitted files there. Backend TypeScript runs through Node's own type stripping, so
use erasable syntax only.

## Checks

1. While iterating, run one test file: `node --test test/<name>.test.js`.
2. Before committing, `npm test` (typecheck, lint and the whole `node --test` suite, under a
   minute) must pass.
3. Smoke boot: `PORT=3999 node server.ts > /tmp/boot.log 2>&1 &`, then
   `curl -s -o /dev/null -w '%{http_code}\n'` against `/`, `/auth/status` and
   `/api/exercises`. Expect 200, 200, and 401 (no token). Kill the server afterwards.

## Review

- Does `public/` still run in the browser as it is, with no build step or emitted files?

## Host only

Some acceptance criteria can only be checked on the host (launching the .app, autoquit timing,
a real sync, the OAuth round trip). Do not claim them. Once the rest is done, comment on the
issue listing which criteria you verified and which are left for a human on the host.
