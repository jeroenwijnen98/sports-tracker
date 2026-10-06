// @ts-check

/** @typedef {import('../../../types/domain.ts').Exercise} Exercise */

// An ISO 8601 time that names its own offset (a TCX `<Id>` is `…Z`).
const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * An exercise's start as up to two numbers: `instant` (ms since the epoch, UTC)
 * and `wallClock` (the local start time read as if it were UTC). Polar's
 * `start-time` is local without an offset, which `start-time-utc-offset`
 * (minutes) turns into an instant; a TCX `<Id>` is an instant with no local
 * time; a Polar data export's `startTime` is local with no offset.
 *
 * @param {Exercise} ex
 * @returns {{ instant: number | null, wallClock: number | null }}
 */
export function startOf(ex) {
  const start = ex['start-time'];
  if (!start) return { instant: null, wallClock: null };

  if (EXPLICIT_OFFSET.test(start)) {
    const instant = Date.parse(start);
    return { instant: Number.isNaN(instant) ? null : instant, wallClock: null };
  }

  const wallClock = Date.parse(`${start}Z`);
  if (Number.isNaN(wallClock)) return { instant: null, wallClock: null };
  const offset = ex['start-time-utc-offset'];
  return {
    instant: typeof offset === 'number' ? wallClock - offset * 60 * 1000 : null,
    wallClock,
  };
}

/**
 * How much later `b` starts than `a`, in ms (negative when `b` starts first):
 * compared as instants when both have one, else as local times when both have
 * one. Null when neither works (a UTC TCX against an export without offset):
 * their starts cannot be told.
 *
 * @param {Exercise} a
 * @param {Exercise} b
 * @returns {number | null}
 */
export function startDelta(a, b) {
  const sa = startOf(a);
  const sb = startOf(b);
  if (sa.instant !== null && sb.instant !== null) return sb.instant - sa.instant;
  if (sa.wallClock !== null && sb.wallClock !== null) return sb.wallClock - sa.wallClock;
  return null;
}

/**
 * How far apart two exercises start, in ms, compared as `startDelta` does.
 * Null when their starts cannot be told.
 *
 * @param {Exercise} a
 * @param {Exercise} b
 * @returns {number | null}
 */
export function startGap(a, b) {
  const delta = startDelta(a, b);
  return delta === null ? null : Math.abs(delta);
}
