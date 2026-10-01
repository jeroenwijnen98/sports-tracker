// @ts-check

import { getExercises } from './api.js';
import { ingestAndSave } from './intake.js';

/** @typedef {import('./intake.js').IntakeCounts} IntakeCounts */

/**
 * Sync exercises from Polar into IndexedDB. `/api/exercises` returns the whole
 * server-side exercise cache, which goes through intake as it is.
 *
 * @returns {Promise<{ counts: IntakeCounts, newIds: string[] }>}
 */
export async function syncExercises() {
  return ingestAndSave(await getExercises());
}

