import { getExercises } from './api.js';
import { getAll, put, putMany, get } from './db.js';

const RUNNING_SPORTS = ['RUNNING', 'TRAIL_RUNNING', 'TREADMILL_RUNNING'];

/**
 * Sync exercises from Polar API into IndexedDB.
 * Returns { newExercises, total } with counts.
 */
export async function syncExercises() {
  const remote = await getExercises();

  // Filter to running sports only
  const runningExercises = remote.filter((ex) =>
    RUNNING_SPORTS.includes(ex['detailed-sport-info'])
  );

  if (runningExercises.length === 0) {
    const existing = await getAll('exercises');
    return { newExercises: 0, total: existing.length };
  }

  // Get existing IDs
  const existing = await getAll('exercises');
  const existingIds = new Set(existing.map((e) => e.id));

  // Find new exercises
  const newOnes = runningExercises.filter((e) => !existingIds.has(e.id));

  if (newOnes.length > 0) {
    // Auto-assign default shoe to new exercises
    await assignDefaultShoe(newOnes);
    await putMany('exercises', newOnes);
  }

  const total = existingIds.size + newOnes.length;
  return { newExercises: newOnes.length, total };
}

/**
 * Assign the default shoe ID to exercises that don't have one.
 */
async function assignDefaultShoe(exercises) {
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
 */
export async function recalcShoeKm(shoeId) {
  const exercises = await getAll('exercises');
  const assigned = exercises.filter((e) => e.shoeId === shoeId);
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
    await recalcShoeKm(shoe.id);
  }
}
