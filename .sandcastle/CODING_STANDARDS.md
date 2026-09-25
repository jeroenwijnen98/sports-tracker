# Coding Standards

The reviewer agent loads this file via @.sandcastle/CODING_STANDARDS.md. It
supplements `CLAUDE.md` and `CONTEXT.md` in the repo root; where they differ,
those win.

## Style

- ES modules throughout (`"type": "module"`).
- The Node side is moving to **TypeScript, run as it is**: Node strips the types
  itself, with no build step and no emitted files. So:
  - only erasable syntax: no `enum`, `namespace`, parameter properties or
    `import x = require()`;
  - every relative import names its file with its real extension (`.ts` or `.js`);
  - a type-only import says so (`import type`): Node deletes it, and a plain
    import of a name that exists only as a type fails at run time.
- `public/` stays vanilla JS that the browser loads as it is: no framework, no
  bundler, no build step. It is typed with JSDoc and `// @ts-check`, against the
  same shared domain types the server uses. Change a shape there, not in two places.
- Every outbound call lives in `src/services/`; the frontend only talks to this
  server, through `public/js/api.js`.
- Theme tokens live in `public/css/variables.css`; raw hex appears only there.
- User-facing text is Dutch.

## Domain language

`CONTEXT.md` is the domain model. Names in code follow it (exercise, lap,
trackpoint, route, detail data, heart rate sensor, smoothness) and avoid the
words it lists under _Avoid_.

## Things that break silently

- Polar fields are hyphenated (`start-time`, `detailed-sport-info`): bracket
  notation, never an IndexedDB key path or index.
- TCX/GPX must be fetched during the Polar transaction, before commit, from
  `{exerciseUrl}/tcx`. Never reorder that flow.
- The idle shutdown counts `/api/session` SSE connections, and `/auth/*` sets a
  hold. Keep both when touching server startup or routes.
- The .app launcher and `run.sh` name the server and sync entry files. Renaming
  either file means updating them in the same commit.
