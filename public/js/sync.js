// @ts-check

import { getExercises } from './api.js';
import { getAll, put, get } from './db.js';
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

/**
 * Recalculate total km for a shoe based on assigned exercises.
 *
 * @param {number} shoeId
 * @returns {Promise<number>} Kilometres run in the shoe here, without its initial km.
 */
export async function recalcShoeKm(shoeId) {
  const exercises = await getAll('exercises');
  const assigned = exercises.filter((e) => e.shoeId === shoeId && !e.overlap);
  const totalMeters = assigned.reduce((sum, e) => sum + (e.distance || 0), 0);
  const shoe = await get('shoes', shoeId);
  if (shoe) {
    shoe.totalKm = (shoe.initialKm || 0) + totalMeters / 1000;
    await put('shoes', shoe);
  }
  return totalMeters / 1000;
}

/**
 * Recalculate km for all shoes.
 */
export async function recalcAllShoeKm() {
  const shoes = await getAll('shoes');
  for (const shoe of shoes) {
    if (shoe.id !== undefined) await recalcShoeKm(shoe.id);
  }
}
