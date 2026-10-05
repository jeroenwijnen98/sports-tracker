# Coding Standards

Read during review: by `/code-review`, and by the sandcastle reviewer
(`.sandcastle/review-prompt.md`). It supplements `CLAUDE.md` and `GLOSSARY.md`; where they
differ, those win.

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

- Names in code follow `GLOSSARY.md`, avoided synonyms included. A change of
  meaning goes there.

## Things that break silently

- Polar fields are hyphenated (`start-time`, `detailed-sport-info`): bracket
  notation, never an IndexedDB key path or index.
- TCX/GPX must be fetched during the Polar transaction, before commit, from
  `{exerciseUrl}/tcx`. Never reorder that flow.
- The idle shutdown counts `/api/session` SSE connections, and `/auth/*` sets a
  hold. Keep both when touching server startup or routes.
- The .app launcher and `run.sh` name the server and sync entry files. Renaming
  either file means updating them in the same commit.
