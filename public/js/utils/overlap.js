// @ts-check

import { parseISODuration } from './format.js';
import { startDelta } from './startTime.js';

/** @typedef {import('../../../types/domain.ts').Exercise} Exercise */

// Two recordings of the same run start within this window of each other.
const OVERLAP_THRESHOLD_MS = 5 * 60 * 1000;

// The phone app (Polar Beat) is the recording that gives way to a watch.
/** @type {(device: string | undefined) => boolean} */
const isPhoneApp = (device) => !device || device === 'Polar Beat';

/**
 * Whether two recordings started within the window and ran at the same time.
 * Starts are compared as exercise identity compares them; a start that cannot
 * be compared (none, or an instant against a local time) is never an overlap.
 *
 * @param {Exercise} a
 * @param {Exercise} b
 */
function overlapsInTime(a, b) {
  const delta = startDelta(a, b);
  if (delta === null || Math.abs(delta) >= OVERLAP_THRESHOLD_MS) return false;
  // b starts before a ends, and a starts before b ends.
  return delta < parseISODuration(a.duration) * 1000 && -delta < parseISODuration(b.duration) * 1000;
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
