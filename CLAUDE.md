# CLAUDE.md

## What This Is

A personal running dashboard that syncs data from the Polar AccessLink API, stores it in IndexedDB for offline use, and displays it with a Nike Run Club-inspired dark UI. Runs locally on localhost:3000. All user-facing text is in Dutch.

## Running the App

Normally: open **SportsTracker.app** (in the repo, or installed to /Applications
via `./install-app.command`). It starts the server if the port is free, opens the
browser, and exits. The server it starts runs with `SPORTS_AUTOQUIT=1`, so it
shuts itself down about 15 seconds after the last browser window closes — see
`src/services/idleShutdown.ts`. Each page holds an SSE connection to
`/api/session`; the count of open connections is what "a window is open" means.

The OAuth round trip is the one case where no window is open but the server must
survive: hitting `/auth/*` sets a 5-minute hold, or the server would quit while
the browser sits on flow.polar.com and `/auth/callback` would find a dead port.

```bash
node server.ts          # starts Express on http://localhost:3000
```

Started by hand like that, autoquit is **off** and the server runs until killed —
which also means a hand-started server occupies the port and the .app will just
point the browser at it rather than starting a self-quitting one. The bundle's
icon is built from `public/logo.png` by `scripts/generate-icon.sh`; rerun it
after changing the logo, then `./install-app.command`.

## Weekly Sync

`run.sh` is called from productivity-hub's sleepwatcher wake script and runs
`scripts/sync.ts`, appending to `logs/sync.log`. It derives its own project
directory from the script's location, so it keeps working if the repo moves (a
failure there is silent). It also probes for node in the known install
locations, because sleepwatcher hands it a bare PATH.

There are no build steps and no linter; the checks are `npm run typecheck`
(strict, the whole repo) and `npm test`. The app requires a `.env` file with
`POLAR_CLIENT_ID` and `POLAR_CLIENT_SECRET`.

## Type checking

```bash
npm run typecheck       # tsc -p . — checks only, never emits
```

The backend is TypeScript that Node runs as it is (type stripping), so
`tsconfig.json` allows erasable syntax only (no `enum`, `namespace` or
constructor parameter properties), requires `import type` for type-only imports,
and lets relative imports name their `.ts` extension. `strict` and `checkJs` are
on for everything in `include` (`server.ts`, `src`, `scripts`, `public/js`,
`test`, `types`), so no file there goes unchecked. The frontend stays `.js`
served as it is and typed through JSDoc, as do the tests and
`test/fixtures/generate-hr-fixtures.js`. The frontend files still
start with `// @ts-check` for editors that open them outside the project; a new
one should too, but a missing pragma can no longer hide a file from the check.
Nothing in the backend is `.js`, so a new backend file is `.ts`. `db.js` maps
each store name to its record type, so `getAll('shoes')` is a `Shoe[]`.
Elements the page always has are cast from `getElementById` with `/** @type {HTMLElement} */`.
Leaflet is typed by the `@types/leaflet` dev dependency only: `runDetail.js`
names it `typeof import('leaflet')` in JSDoc and `loadLeaflet()` returns the
`window.L` the CDN script sets, so nothing imports it at run time.

The shared domain types live in `types/domain.ts` (exercise, lap, trackpoint,
route, detail data, shoe, heart rate sensor, smoothness). Server code imports
them with `import type`; frontend files reference them with a JSDoc
`@typedef {import('../../types/domain.ts').Exercise} Exercise`, so the browser
never loads the file. Change a shape there, not in two places.

The whole backend is `.ts`: the server entry `server.ts`, the routes, config,
the `tokenCheck` middleware, every service in `src/services/` and the two Node
scripts (`scripts/sync.ts`, `scripts/classify-sensors.ts`), all run with plain
`node`. Type stripping needs Node 22.18 or later. What `tokenCheck` adds to the request (`accessToken`,
`polarUserId`) is declared in `types/express.d.ts`.

## Tests

```bash
npm test                # node --test 'test/**/*.test.js'
```

Zero dependencies: Node's built-in test runner, no `.env` or `src/data` needed.
The tests cover pure logic only (import converters, overlap, exercise identity, intake, the import pipeline (`importFiles` against fake files and adapters) with its device map and import toast, shoe totals, the default shoe rule, detail data loading, the detail view's current-run ticket, the detail chart series,
heart rate sensor classifier, formatters, running sports, HTML escaping), the transaction consumer and `syncFromPolar()` against a fake `request`, `importExercise()` against an in-memory store, plus the exercise cache against a temp directory — no
browser, no Polar API. Frontend modules in `public/js/utils/` are imported
straight into Node, so keep them free of DOM access.

Every file-backed store resolves its directory from `DATA_DIR` in `src/config.ts`:
`SPORTS_DATA_DIR` if set, else `src/data`. A test that touches a store sets
`SPORTS_DATA_DIR` to a temp dir **before** importing it (see
`test/exerciseCache.test.js`), so the tests never write to `src/data`.

The heart rate sensor fixtures in `test/fixtures/` are synthetic, written by
`node test/fixtures/generate-hr-fixtures.js`, and carry no route. Never commit a
fixture with GPS coordinates from a real run. `test/hrSensor.test.js` snapshots
their `smoothness` and `label`, so update it when recalibrating.

## Architecture

**Backend (src/):** Node.js + Express, services in TypeScript run by Node as they are, with only two dependencies (`express`, `dotenv`). ES modules throughout (`"type": "module"`).

- `server.ts` — Entry point, mounts routes and serves `public/` as static files
- `src/routes/auth.ts` — OAuth2 flow: `/auth/login`, `/auth/callback`, `/auth/status`, `/auth/logout`
- `src/routes/api.ts` — Polar API proxy: `/api/exercises`, `/api/exercises/:id` (DELETE only, to remove it from the exercise cache), `/api/exercises/:id/:type` (one handler for `tcx` and `gpx`; any other type falls through to 404), plus the `/api/exercises/import` (TCX) and `/import-json` (Polar data export) routes, thin adapters over `importExercise()`: each validates its body (400), and maps `imported` to 200, `duplicate` to 409 with one body for both, `{ error, exercise }` with the stored exercise, and a thrown error to 500. Protected by `tokenCheck` middleware
- `src/services/importConverters.ts` — Pure converters behind the import routes: `polarJsonToTcx(session)`, `polarJsonToExercise(session)`, `extractTcxMetadata(xml)`. Both import paths derive the same `import-…` id from the start time
- `src/services/importExercise.ts` — `importExercise(source, store) → { status: 'imported' | 'duplicate', exercise }`, `source` being `{ kind: 'tcx', xml }` or `{ kind: 'json', session }`: the one place an import is converted and secured. An id already stored is a duplicate and writes nothing. Otherwise the exercise is saved first, then its TCX; a failed TCX write takes the exercise back out (`revertAppend`), so neither is left without the other and an existing TCX is never removed. The exercise comes back with the heart rate sensor `writeXmlCache` just classified. `store` is injected like `diskStore`; `diskImportStore` (exercise cache + XML cache) is the real one
- `src/services/polarApi.ts` — `polarRequest(accessToken, pathOrUrl, { method, accept, body })` is the one AccessLink HTTP helper (auth header, Accept, throw on non-2xx); everything that talks to AccessLink goes through it. `withToken(accessToken)` binds the token, giving the `request` the sync takes. `XML_ACCEPT` maps `tcx`/`gpx` to their Accept types. It knows nothing about transactions
- `src/services/transactionConsumer.ts` — `consumeTransaction({ request, store, userId }) → { secured, failed }`: the one place that owns the Pull Notifications transaction (POST create → GET list → GET each exercise with its TCX/GPX → PUT commit) and its secure-before-commit invariant. `request` is `polarRequest` with the token bound, `store` writes exercise JSON and TCX/GPX; `diskStore` (exercise cache + XML cache) is the real one and skips deleted exercises. Commits only when nothing failed, otherwise leaves the transaction open and returns the failed URLs
- `src/services/polarSync.ts` — `syncFromPolar({ request, userId }) → SyncResult`: the one place both Polar sources are combined (`consumeTransaction()` with `diskStore`, which caches every exercise whatever its sport, then the Training Data API top-up whose failure is only logged). It skips deleted exercises from the Training Data API itself; `diskStore` does so for the transaction. `SyncResult.failed` carries the consumer's failed URLs. Called by `/api/exercises` and `scripts/sync.ts`, which writes each failed URL to `logs/sync.log`
- `src/services/polarAuth.ts` — OAuth token exchange with Basic auth, user registration
- `src/services/tokenStore.ts` — Reads/writes `src/data/token.json` (gitignored)
- `src/services/xmlCache.ts` — Server-side file cache for TCX/GPX XML in `src/data/tcx/` and `src/data/gpx/`
- `src/services/exerciseCache.ts` — Server-side exercise JSON cache (`src/data/exercises.json`). Deleting an exercise removes it here and records its id in `src/data/deletedExercises.json`, which `syncFromPolar()` skips so the Training Data API cannot bring it back; its TCX/GPX and sensor entry stay on disk
- `src/services/hrSensor.ts` — Infers chest strap vs. wrist heart rate sensor from TCX signal texture, cached in `src/data/hrSensor.json`

**Frontend (public/):** Vanilla HTML/CSS/JS with ES modules, no bundler. The `.js` is served as it is and type-checked through JSDoc against `types/domain.ts`.

- `public/js/app.js` — Entry point: auth check, tab switching, sync trigger
- `public/js/db.js` — IndexedDB wrapper (4 stores: `exercises`, `shoes`, `settings`, `details`). `transaction(storeNames, fn)` runs one readwrite transaction over several stores; inside `fn`, await only its own requests or it commits early. Version 2 created `details` and moved each exercise's old `detailData` field into it (`splitDetailData`)
- `public/js/intake.js` — The one way exercises enter IndexedDB. Pure core `ingest(incoming, { existing, shoes }) → { toSave, updatedExisting, counts }`: running sport filter, new vs. stored by id, then exercise identity (via `sameExercise`: the same run under another id is not saved, only counted in `counts.duplicates`; within a batch the Polar-synced copy wins), overlap (via `markOverlaps`), default shoe for new exercises only, and the heart rate sensor backfill onto stored exercises. `ingestAndSave(incoming)` reads the stores, calls `ingest`, writes the result in one transaction and returns `{ counts, newIds }`. No DOM in the core, so Node tests import it
- `public/js/import.js` — The import pipeline, no DOM: `importFiles(files, { importTcx, importJson, ingestAndSave }) → { counts, duplicates, newIds }` takes `{ name, text() }` objects as `File` is. It builds the device map from every `products-devices*` file, sends `.json` files to the JSON import (skipping JSON without `exercises`) and every other file to the TCX import, counts the server's 409 duplicates, renames each exercise's device through the map, logs a failing file and goes on, and hands the rest to `ingestAndSave`. Its leaves: `parseDeviceMap(contents)` turns a Polar data export's `products-devices` file into a device id → name map (archived devices named through their DELETE registration event; a malformed file gives an empty map), and `importToast(counts, duplicates)` builds the toast from intake's counts plus the server's duplicates, shown together as one duplicate number. The import handler in `app.js` makes the one `importFiles` call and keeps only button state, toast, detail prefetch and re-render, like sync. An imported exercise carries the heart rate sensor the server just classified, and intake keeps it on the new exercise
- `public/js/shoes.js` — Shoes module, no DOM; the shoes view goes through it and never touches the `shoes` store. Pure `shoeTotals(shoes, exercises) → Map<shoeId, km>` (via `loadShoes()`, once per render). `addShoe`, `updateShoe`, `deleteShoe` and `setDefaultShoe` each run as one transaction (`transaction()` in `db.js`) and leave exactly one default shoe whenever any exists, through pure `oneDefault()`: the first shoe becomes the default, deleting the default promotes the newest remaining shoe, deleting a shoe unassigns its exercises. `createShoeOperations(transact)` takes the transaction, so Node tests inject an in-memory one
- `public/js/sync.js` — `syncExercises()` fetches `/api/exercises` (the whole server exercise cache) and hands it to `ingestAndSave`
- `public/js/api.js` — Backend calls. `request()` handles 401 (reload) and errors; `{ duplicate: true }` turns a 409 into the existing exercise flagged `_duplicate`, which both import calls use
- `public/js/views/` — Tab renderers (`activities.js`, `shoes.js`)
- `public/js/components/` — Reusable UI: `runCard.js`, `shoeCard.js`, `modal.js`, `toast.js`
- `public/js/utils/` — Formatters for distance, pace, duration, dates. Every pace goes through `paceParts(secondsPerKm)` in `format.js`: rounded to the nearest second with the carry into minutes, so `:60` never appears (`formatPace`, the chart's `formatPaceLabel`, the activity view's `m'ss''`)
- `public/js/utils/sports.js` — `RUNNING_SPORTS`, their labels, `isRunningSport(exercise)` and the `isRunningSportName(sport)` type guard: the one running sport list, also imported by `src/services/importConverters.ts`
- `public/js/utils/html.js` — `escapeHtml()`, the one escaper for user- or file-controlled strings (shoe name/brand, device) put into markup
- `public/js/utils/identity.js` — `sameExercise(a, b)`: exercise identity as `GLOSSARY.md` defines it. Start and duration within 5 s, starts compared as instants (Polar `start-time` minus `start-time-utc-offset`, a TCX `<Id>` in UTC) or, when one side has no offset (a Polar data export), as local times. Never two Polar-synced exercises, never a Polar Beat against another named device. Pure; called only by intake
- `public/js/utils/overlap.js` — `markOverlaps(imported, existing)`: marks the phone recording (Polar Beat, or no device) as overlap when a watch recording started within 5 minutes and overlaps in time, both within an import batch and against stored exercises. Pure; called only by intake
- `public/js/services/detailData.js` — One function, `load(exerciseId, { force })`: reads the `details` store, else fetches TCX (GPX only when there is no TCX), parses and stores it. Concurrent loads of one id share a fetch; `force` (the retry button) ignores the unavailable marker. Never touches the `exercises` store. `forget(id)` removes an exercise's entry once any load of it in flight has finished; deleting from the detail view calls it. `createDetailLoader()` takes the store and fetchers and returns both, so Node tests inject them
- `public/js/utils/currentView.js` — `createCurrentView()`: the ticket the detail view takes on each opening. `runDetail.js` checks it after every await, so a load (initial or retry) or Leaflet arriving for another run, or after the view closed, draws nothing
- `public/js/utils/chartSeries.js` — The detail chart's numbers, no DOM: `buildChartSeries(detail) → ChartSeries | null` turns trackpoints into about 400 samples (pace derived over ±4 trackpoints when `<Speed>` is missing, rolling averages, a pace gap below 1 m/s, capped at 15 min/km; the last trackpoint is always kept) with each metric's range, `null` when the metric is absent. No trackpoints (GPX-only detail data) gives `null`. Also `axisBounds`, `kmTickStep`, the scrub cursor's `nearestSample(series, d)` and the pace label `formatPaceLabel(minPerKm)`. `runDetail.js` draws from it, and its `renderChart()` is the one place, for the first load and the retry, that shows the chart section only when `buildChartSeries` gives a series
- `public/js/utils/tcxParser.js` — Parses TCX XML into laps, trackpoints (HR, speed, distance), route coordinates
- `public/js/utils/gpxParser.js` — Parses GPX XML into route coordinates
- `public/js/views/runDetail.js` — Full-screen detail overlay with HR/pace chart, laps table, and Leaflet map

## Key Design Decisions

- **Sport filter:** Only `RUNNING`, `TRAIL_RUNNING`, `TREADMILL_RUNNING`, `ULTRARUNNING_RUNNING` are synced/shown — defined once in `public/js/utils/sports.js`
- **Shoe km tracking:** a shoe's total is initial km plus the distance of every assigned exercise that is not an overlap. It is not stored: `shoeTotals(shoes, exercises)` in `public/js/shoes.js` derives it each time the shoes tab renders, so deleting an exercise or changing its overlap state needs no extra call. Older shoe records may still carry a stale `totalKm` field; nothing reads it
- **Polar API constraint:** once a transaction is committed (PUT), its exercises and their TCX/GPX are gone from that channel — the server-side cache is the permanent record (see "An uncommitted exercise transaction")
- **Eager TCX/GPX caching:** `consumeTransaction()` fetches TCX and GPX and saves them to disk, with the exercise JSON, during the sync transaction (before commit), because they become permanently inaccessible after commit. The server-side cache in `src/data/tcx/` and `src/data/gpx/` is the permanent record for detail data
- **Dual exercise sources:** Sync combines Pull Notifications (transaction flow) with the Training Data API (`/v3/exercises`) and deduplicates by ID. The `/api/exercises/:id/tcx` and `/gpx` routes serve from server-side cache first, then fall back to the Training Data API
- **Token never expires:** Single OAuth flow, token persisted server-side as JSON file
- **CSS theme:** Dark background (#0D0D0D), neon-green accent (#CEFF00), defined in `public/css/variables.css`
- **Heart rate sensor inference:** Since no field records which sensor was used, `hrSensor.ts` classifies it from the texture of the 1 Hz series — a chest strap keeps beat-to-beat detail, wrist optical is heavily filtered and repeats values. Classification hangs off `writeXmlCache()` so every newly cached TCX is labelled; `node scripts/classify-sensors.ts` rebuilds the whole map. The label rides along on the exercises endpoints and intake (`public/js/intake.js`) copies it into IndexedDB. **It is calibrated on 53 known chest strap runs plus the two runs in `src/services/hrSensorTruth.json` whose sensor is confirmed first-hand, so it is indicative only** — read `smoothness` rather than `label`, and recalibrate the constants marked `RECALIBRATE_ME` once more runs have a confirmed sensor. Add every run whose sensor you know to `hrSensorTruth.json`; `classify-sensors.ts` scores against it

## Polar AccessLink API

The Polar API has two separate data access paths that behave very differently:

- **Pull Notifications (transaction flow):** `POST /v3/users/{userId}/exercise-transactions` → `GET list` → `GET each` → `PUT commit`. Owned by `consumeTransaction()`. This is one-time consumption — once committed, exercises and their TCX/GPX are gone forever. TCX/GPX must be fetched during the transaction using `{exerciseUrl}/tcx` (the full transaction URL, NOT `/v3/exercises/{id}/tcx`). After de-registration and re-registration, only exercises recorded after the new registration date appear
- **Training Data API:** `GET /v3/exercises`, `GET /v3/exercises/{id}/tcx`. Separate system, not one-time consumption: exercises and their TCX/GPX can be re-fetched for 30 days after upload to Flow. May take time to populate after user registration. Requires the user's Polar watch to sync via the Polar Flow app first
- **De-registering a user** (`DELETE /v3/users/{userId}`) resets the Pull Notifications state but does NOT bring back historically consumed exercises through that channel. Use this as a last resort
- **User ID** is returned in the OAuth token response as `x_user_id` and persisted in `token.json`

### An uncommitted exercise transaction

Checked against the AccessLink v3 reference (polar.com/accesslink-api, "Exercises (deprecated)" section, read 2026-10-01), Polar's own `accesslink-example-python` and the issues on it. No transaction was opened against the live account to find out.

- **Does it block the next one?** Undocumented. `POST …/exercise-transactions` lists only 201 (new transaction), 204 (no new training data) and 403; no status for "a transaction is already open", and nothing says whether a second POST returns the open transaction, a new one, or 204.
- **Does it expire, and when?** Undocumented. The reference gives no lifetime for a transaction. It does say only exercises uploaded to Flow in the last 30 days are offered (28 in the section intro).
- **What happens to its exercises?** Only the commit is documented as removing them: `PUT` answers 200 "Transaction has been committed and data deleted". Polar's maintainer confirms only committed exercises stop being offered (accesslink-example-python#3). Whether an expired transaction's exercises are offered again or dropped is undocumented.
- **Can its exercises, TCX and GPX be fetched more than once?** Not stated outright, but implied: the GETs carry no "once only" note, and the data is deleted only on commit.
- The transactional exercise endpoints are marked **deprecated** in favour of the non-transactional `/v3/exercises`. That API serves the same exercises with TCX/GPX for 30 days, whatever the transaction's state.

**Partial-failure policy for the transaction consumer:** commit only when every exercise in the transaction, with its TCX and GPX, is on disk. If anything fails, **leave the transaction open**, don't commit, and report the failed exercise ids. The next sync retries. Committing anyway is the only choice certain to lose data: commit is the one documented way to delete it. If an open transaction blocks or expires, that is at worst no worse than committing. Even then the Training Data API top-up in `syncFromPolar()` still picks up new exercises for 30 days. So don't commit in an error path "so it doesn't block future ones", because that assumption is undocumented. If sync logs show the same open transaction never clearing, ask b2bhelpdesk@polar.com rather than testing it on the live account.

`consumeTransaction()` in `src/services/transactionConsumer.ts` follows this policy, and both sync entry points go through it. A transaction left open shows up in `logs/sync.log` as `[sync]   failed: <url>` lines.

## Gotchas

- IndexedDB key paths cannot contain hyphens. Polar API returns fields like `start-time` and `detailed-sport-info` — access these with bracket notation, never use them as IndexedDB indexes
- Polar's exercise transaction returns 204 when there's no new data. A committed transaction's data won't appear again — always rely on locally cached exercises
- **Never use `/v3/exercises/{id}/tcx` during a transaction** — that's the Training Data API endpoint. During a transaction, use `{exerciseUrl}/tcx` where `exerciseUrl` is the full transaction URL like `https://www.polaraccesslink.com/v3/users/{userId}/exercise-transactions/{transactionId}/exercises/{exerciseId}`
- The `src/data/` directory is gitignored (contains `token.json`, `exercises.json`, `deletedExercises.json`, `hrSensor.json`, `tcx/`, `gpx/`)
- Polar's `device` / `device-id` name the **recording** device, not the heart rate source. A Pacer run with a paired H10 and one on wrist optical are labelled identically, and `SensorState` in the TCX is `Present` in all but 8 of 111k samples — it carries no information
- Leaflet is loaded dynamically from CDN only when GPS data exists in the exercise
- Frontend caches parsed detail data in its own `details` IndexedDB store, keyed by exercise id, never on the exercise record. An `{ id, unavailable: true, checkedAt }` entry with a TTL prevents repeated fetches for exercises without detail data

## Agent skills

### Issue tracker

Issues live as GitHub issues in `jeroenwijnen98/sports-tracker`, driven with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical labels, used verbatim: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root (`docs/adr/` does not exist yet; created lazily). See `docs/agents/domain.md`.
