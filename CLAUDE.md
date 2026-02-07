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
- `src/routes/api.js` — Polar API proxy: `/api/exercises`, `/api/exercises/:id`. Protected by `tokenCheck` middleware
- `src/services/polarApi.js` — Implements Polar's transaction-based exercise fetch (POST create → GET list → GET each → PUT commit)
- `src/services/polarAuth.js` — OAuth token exchange with Basic auth, user registration
- `src/services/tokenStore.js` — Reads/writes `src/data/token.json` (gitignored)

**Frontend (public/):** Vanilla HTML/CSS/JS with ES modules, no bundler.

- `public/js/app.js` — Entry point: auth check, tab switching, sync trigger
- `public/js/db.js` — IndexedDB wrapper (3 stores: `exercises`, `shoes`, `settings`)
- `public/js/sync.js` — Pulls exercises from backend, filters to running sports, auto-assigns default shoe, recalculates shoe km
- `public/js/views/` — Tab renderers (`activities.js`, `shoes.js`)
- `public/js/components/` — Reusable UI: `runCard.js`, `shoeCard.js`, `modal.js`, `toast.js`
- `public/js/utils/` — Formatters for distance, pace, duration, dates

## Key Design Decisions

- **Sport filter:** Only `RUNNING`, `TRAIL_RUNNING`, `TREADMILL_RUNNING` are synced/shown
- **Shoe km tracking:** `totalKm = initialKm + sum(assigned exercise distances)`. Recalculated on sync and shoe edit
- **Polar API constraint:** The transaction flow (POST/GET/PUT) means each exercise can only be fetched once — local IndexedDB storage is the permanent record
- **Token never expires:** Single OAuth flow, token persisted server-side as JSON file
- **CSS theme:** Dark background (#0D0D0D), neon-green accent (#CEFF00), defined in `public/css/variables.css`

## Gotchas

- IndexedDB key paths cannot contain hyphens. Polar API returns fields like `start-time` and `detailed-sport-info` — access these with bracket notation, never use them as IndexedDB indexes
- Polar's exercise transaction returns 204 when there's no new data. A committed transaction's data won't appear again — always rely on locally cached exercises
- The `src/data/` directory is gitignored (contains `token.json`)
