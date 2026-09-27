// @ts-check

import { parseISODuration } from './format.js';

/** @typedef {import('../../../types/domain.ts').Exercise} Exercise */

// Two recordings of the same run start within this window of each other.
const OVERLAP_THRESHOLD_MS = 5 * 60 * 1000;

// The phone app (Polar Beat) is the recording that gives way to a watch.
/** @type {(device: string | undefined) => boolean} */
const isPhoneApp = (device) => !device || device === 'Polar Beat';

/**
 * @param {Exercise} a
 * @param {Exercise} b
 */
function overlapsInTime(a, b) {
  const aStart = new Date(a['start-time']).getTime();
  const aEnd = aStart + parseISODuration(a.duration) * 1000;
  const bStart = new Date(b['start-time']).getTime();
  const bEnd = bStart + parseISODuration(b.duration) * 1000;
  return Math.abs(aStart - bStart) < OVERLAP_THRESHOLD_MS && aStart < bEnd && bStart < aEnd;
}

/**
 * Mark overlap on newly imported exercises (e.g. Polar Beat and a Polar Pacer
 * recording the same run). The phone recording gets `overlap: true`, so it
 * stays visible but no longer counts towards totals.
 *
 * Does not mutate its arguments. Returns the imported exercises with overlap
 * marked, the existing exercises that are newly marked (to be saved), and how
 * many exercises were marked in total.
 *
 * @param {Exercise[]} imported
 * @param {Exercise[]} existing
 * @returns {{ imported: Exercise[], updatedExisting: Exercise[], count: number }}
 */
export function markOverlaps(imported, existing) {
  const result = imported.map((ex) => ({ ...ex }));
  /** @type {Map<Exercise, Exercise>} */
  const updated = new Map();
  let count = 0;

  // 1. Within the import batch: mark phone recordings that overlap a watch one
  for (const ex of result) {
    if (!isPhoneApp(ex.device)) continue;
    const hasWatchOverlap = result.some((other) =>
      other !== ex && !isPhoneApp(other.device) && overlapsInTime(ex, other)
    );
    if (hasWatchOverlap) {
      ex.overlap = true;
      count++;
    }
  }

  // 2. Cross-check against the exercises already stored
  for (const ex of result) {
    if (ex.overlap) continue;
    if (isPhoneApp(ex.device)) {
      // Importing phone: overlap when a watch recording is already stored
      const hasWatchStored = existing.some((stored) =>
        !isPhoneApp(stored.device) && overlapsInTime(ex, stored)
      );
      if (hasWatchStored) {
        ex.overlap = true;
        count++;
      }
    } else {
      // Importing watch: stored phone recordings become the overlap
      for (const stored of existing) {
        const current = updated.get(stored) ?? stored;
        if (isPhoneApp(current.device) && !current.overlap && overlapsInTime(ex, current)) {
          updated.set(stored, { ...current, overlap: true });
          count++;
        }
      }
    }
  }

  return { imported: result, updatedExisting: [...updated.values()], count };
}
