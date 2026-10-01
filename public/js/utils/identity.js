// @ts-check

import { parseISODuration } from './format.js';

/** @typedef {import('../../../types/domain.ts').Exercise} Exercise */

// Two copies of one exercise agree on start and duration to within these.
// Tight on purpose: two devices recording one run are overlap, not identity.
const START_TOLERANCE_MS = 5 * 1000;
const DURATION_TOLERANCE_S = 5;

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
 * How far apart two exercises start, in ms: compared as instants when both
 * have one, else as local times when both have one. Null when neither works
 * (a UTC TCX against an export without offset): their starts cannot be told.
 *
 * @param {Exercise} a
 * @param {Exercise} b
 * @returns {number | null}
 */
function startGap(a, b) {
  const sa = startOf(a);
  const sb = startOf(b);
  if (sa.instant !== null && sb.instant !== null) return Math.abs(sa.instant - sb.instant);
  if (sa.wallClock !== null && sb.wallClock !== null) return Math.abs(sa.wallClock - sb.wallClock);
  return null;
}

/** @type {(ex: Exercise) => boolean} */
const fromPolarSync = (ex) => !ex.source;

/**
 * Whether two exercises are the same exercise arriving from two sources (a
 * Polar sync and an import, or two imports): their starts and durations match
 * within a few seconds, whatever their ids.
 *
 * Not the same: two exercises both synced from Polar (Polar's ids are
 * authoritative), and a phone (Polar Beat) and another device recording when
 * both name their device — that is overlap.
 *
 * @param {Exercise} a
 * @param {Exercise} b
 * @returns {boolean}
 */
export function sameExercise(a, b) {
  if (a.id === b.id) return true;
  if (fromPolarSync(a) && fromPolarSync(b)) return false;
  if (a.device && b.device && (a.device === 'Polar Beat') !== (b.device === 'Polar Beat')) return false;

  const gap = startGap(a, b);
  if (gap === null || gap > START_TOLERANCE_MS) return false;
  return Math.abs(parseISODuration(a.duration) - parseISODuration(b.duration)) <= DURATION_TOLERANCE_S;
}
