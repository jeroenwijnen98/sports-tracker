import { getExercises, getCachedExercises } from './api.js';
import { getAll, put, putMany, get } from './db.js';

const RUNNING_SPORTS = ['RUNNING', 'TRAIL_RUNNING', 'TREADMILL_RUNNING'];

/**
 * Sync exercises from Polar API + server-side cache into IndexedDB.
 * Returns { newExercises, total } with counts.
 */
export async function syncExercises() {
  // Fetch from both Polar transaction and server-side cache in parallel
  const [remote, cached] = await Promise.all([
    getExercises(),
    getCachedExercises().catch(() => []),
  ]);

  // Merge both sources, deduplicate by id
  const seen = new Set();
  const merged = [];
  for (const ex of [...remote, ...cached]) {
    if (!seen.has(ex.id)) {
      seen.add(ex.id);
      merged.push(ex);
    }
  }

  // Filter to running sports only
  const runningExercises = merged.filter((ex) =>
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
  const newIds = newOnes.map((e) => e.id);
  return { newExercises: newOnes.length, total, newIds };
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
