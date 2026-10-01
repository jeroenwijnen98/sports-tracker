// @ts-check

import { getExercises } from './api.js';
import { getAll } from './db.js';
import { ingestAndSave } from './intake.js';

/** @typedef {import('../../types/domain.ts').Exercise} Exercise */
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

/**
 * Assign the default shoe ID to exercises that don't have one. Mutates them in
 * place; the caller saves them.
 *
 * @param {Exercise[]} exercises
 */
export async function assignDefaultShoe(exercises) {
  const shoes = await getAll('shoes');
  const defaultShoe = shoes.find((s) => s.isDefault);
  if (!defaultShoe) return;

  for (const ex of exercises) {
    if (!ex.shoeId) {
      ex.shoeId = defaultShoe.id;
    }
  }
}
