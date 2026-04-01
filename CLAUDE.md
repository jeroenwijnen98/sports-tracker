# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A personal running dashboard that syncs data from the Polar AccessLink API, stores it in IndexedDB for offline use, and displays it with a Nike Run Club-inspired dark UI. Runs locally on localhost:3000. All user-facing text is in Dutch.

## Running the App

```bash
node server.js          # starts Express on http://localhost:3000
```

There are no build steps, no linter, and no test suite. The app requires a `.env` file with `POLAR_CLIENT_ID` and `POLAR_CLIENT_SECRET`.

## Architecture

**Backend (src/):** Node.js + Express with only two dependencies (`express`, `dotenv`). ES modules throughout (`"type": "module"`).

- `server.js` — Entry point, mounts routes and serves `public/` as static files
- `src/routes/auth.js` — OAuth2 flow: `/auth/login`, `/auth/callback`, `/auth/status`, `/auth/logout`
- `src/routes/api.js` — Polar API proxy: `/api/exercises`, `/api/exercises/:id`, `/api/exercises/:id/tcx`, `/api/exercises/:id/gpx`. Protected by `tokenCheck` middleware
- `src/services/polarApi.js` — Implements Polar's transaction-based exercise fetch (POST create → GET list → GET each → PUT commit). Eagerly fetches and caches TCX/GPX during the transaction before commit
- `src/services/polarAuth.js` — OAuth token exchange with Basic auth, user registration
- `src/services/tokenStore.js` — Reads/writes `src/data/token.json` (gitignored)
- `src/services/xmlCache.js` — Server-side file cache for TCX/GPX XML in `src/data/tcx/` and `src/data/gpx/`
- `src/services/exerciseCache.js` — Server-side exercise JSON cache (`src/data/exercises.json`)

**Frontend (public/):** Vanilla HTML/CSS/JS with ES modules, no bundler.

- `public/js/app.js` — Entry point: auth check, tab switching, sync trigger
- `public/js/db.js` — IndexedDB wrapper (3 stores: `exercises`, `shoes`, `settings`)
- `public/js/sync.js` — Pulls exercises from backend, filters to running sports, auto-assigns default shoe, recalculates shoe km
- `public/js/views/` — Tab renderers (`activities.js`, `shoes.js`)
- `public/js/components/` — Reusable UI: `runCard.js`, `shoeCard.js`, `modal.js`, `toast.js`
- `public/js/utils/` — Formatters for distance, pace, duration, dates
- `public/js/services/detailData.js` — Fetches TCX/GPX from backend, parses them, and caches parsed detail data on exercise objects in IndexedDB
- `public/js/utils/tcxParser.js` — Parses TCX XML into laps, trackpoints (HR, speed, distance), route coordinates
- `public/js/utils/gpxParser.js` — Parses GPX XML into route coordinates
- `public/js/views/runDetail.js` — Full-screen detail overlay with HR/pace chart, laps table, and Leaflet map

## Key Design Decisions

- **Sport filter:** Only `RUNNING`, `TRAIL_RUNNING`, `TREADMILL_RUNNING` are synced/shown
- **Shoe km tracking:** `totalKm = initialKm + sum(assigned exercise distances)`. Recalculated on sync and shoe edit
- **Polar API constraint:** The transaction flow (POST/GET/PUT) means each exercise can only be fetched once — local IndexedDB storage is the permanent record
- **Eager TCX/GPX caching:** TCX and GPX are fetched and saved to disk during the sync transaction (before commit), because they become permanently inaccessible after commit. The server-side cache in `src/data/tcx/` and `src/data/gpx/` is the permanent record for detail data
- **Dual exercise sources:** Sync combines Pull Notifications (transaction flow) with the Training Data API (`/v3/exercises`) and deduplicates by ID. The `/api/exercises/:id/tcx` and `/gpx` routes serve from server-side cache first, then fall back to the Training Data API
- **Token never expires:** Single OAuth flow, token persisted server-side as JSON file
- **CSS theme:** Dark background (#0D0D0D), neon-green accent (#CEFF00), defined in `public/css/variables.css`

## Polar AccessLink API

The Polar API has two separate data access paths that behave very differently:

- **Pull Notifications (transaction flow):** `POST /v3/users/{userId}/exercise-transactions` → `GET list` → `GET each` → `PUT commit`. This is one-time consumption — once committed, exercises and their TCX/GPX are gone forever. TCX/GPX must be fetched during the transaction using `{exerciseUrl}/tcx` (the full transaction URL, NOT `/v3/exercises/{id}/tcx`). After de-registration and re-registration, only exercises recorded after the new registration date appear
- **Training Data API:** `GET /v3/exercises`, `GET /v3/exercises/{id}/tcx`. Separate system that provides persistent access to exercises. Not one-time consumption — data can be re-fetched. May take time to populate after user registration. Requires the user's Polar watch to sync via the Polar Flow app first
- **De-registering a user** (`DELETE /v3/users/{userId}`) resets the Pull Notifications state but does NOT bring back historically consumed exercises through that channel. Use this as a last resort
- **User ID** is returned in the OAuth token response as `x_user_id` and persisted in `token.json`

## Gotchas

- IndexedDB key paths cannot contain hyphens. Polar API returns fields like `start-time` and `detailed-sport-info` — access these with bracket notation, never use them as IndexedDB indexes
- Polar's exercise transaction returns 204 when there's no new data. A committed transaction's data won't appear again — always rely on locally cached exercises
- **Never use `/v3/exercises/{id}/tcx` during a transaction** — that's the Training Data API endpoint. During a transaction, use `{exerciseUrl}/tcx` where `exerciseUrl` is the full transaction URL like `https://www.polaraccesslink.com/v3/users/{userId}/exercise-transactions/{transactionId}/exercises/{exerciseId}`
- The `src/data/` directory is gitignored (contains `token.json`, `exercises.json`, `tcx/`, `gpx/`)
- Leaflet is loaded dynamically from CDN only when GPS data exists in the exercise
- Frontend caches parsed detail data (`detailData`) as a property on exercise objects in IndexedDB. An `{ unavailable: true, checkedAt }` marker with a TTL prevents repeated fetches for exercises without detail data
