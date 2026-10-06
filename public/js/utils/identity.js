// @ts-check

import { parseISODuration } from './format.js';
import { startGap } from './startTime.js';

/** @typedef {import('../../../types/domain.ts').Exercise} Exercise */

// Two copies of one exercise agree on start and duration to within these.
// Tight on purpose: two devices recording one run are overlap, not identity.
const START_TOLERANCE_MS = 5 * 1000;
const DURATION_TOLERANCE_S = 5;

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
