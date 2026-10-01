// @ts-check

import { getAll, putMany } from './db.js';
import { isRunningSport } from './utils/sports.js';
import { markOverlaps } from './utils/overlap.js';

/** @typedef {import('../../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../../types/domain.ts').Shoe} Shoe */

/**
 * What one intake did: how many exercises are new, how many were marked
 * overlap (new or already stored), and how many the store holds afterwards.
 * @typedef {{ newExercises: number, overlaps: number, total: number }} IntakeCounts
 */

/**
 * The intake rules for every exercise entering the browser store. Pure: reads
 * its arguments, mutates none of them.
 *
 * - only running sports get in, and an id already stored is not new;
 * - overlap is marked within the new exercises and against the stored ones;
 * - new exercises without a shoe get the default shoe, stored ones keep theirs;
 * - a changed heart rate sensor is copied onto the stored exercise, touching
 *   nothing else on it (classification can appear or be recalibrated long
 *   after an exercise was first synced).
 *
 * @param {Exercise[]} incoming
 * @param {{ existing: Exercise[], shoes: Shoe[] }} store
 * @returns {{ toSave: Exercise[], updatedExisting: Exercise[], counts: IntakeCounts }}
 */
export function ingest(incoming, { existing, shoes }) {
  const existingById = new Map(existing.map((e) => [e.id, e]));

  /** @type {Map<string, Exercise>} */
  const fresh = new Map();
  for (const ex of incoming) {
    if (!isRunningSport(ex) || existingById.has(ex.id) || fresh.has(ex.id)) continue;
    fresh.set(ex.id, ex);
  }

  const marked = markOverlaps([...fresh.values()], existing);

  const defaultShoeId = shoes.find((s) => s.isDefault)?.id;
  const toSave = marked.imported.map((ex) => {
    if (ex.shoeId || defaultShoeId === undefined) return ex;
    return { ...ex, shoeId: defaultShoeId };
  });

  /** @type {Map<string, Exercise>} */
  const updated = new Map(marked.updatedExisting.map((e) => [e.id, e]));
  for (const ex of incoming) {
    if (!ex.hrSensor) continue;
    const stored = existingById.get(ex.id);
    if (!stored || stored.hrSensor?.smoothness === ex.hrSensor.smoothness) continue;
    updated.set(ex.id, { ...(updated.get(ex.id) ?? stored), hrSensor: ex.hrSensor });
  }

  return {
    toSave,
    updatedExisting: [...updated.values()],
    counts: {
      newExercises: toSave.length,
      overlaps: marked.count,
      total: existing.length + toSave.length,
    },
  };
}

/**
 * Run exercises through `ingest()` against the stored exercises and shoes, and
 * write what it returns in one transaction. Returns the counts and the ids of
 * the new exercises, whose detail data is still to be fetched.
 *
 * @param {Exercise[]} incoming
 * @returns {Promise<{ counts: IntakeCounts, newIds: string[] }>}
 */
export async function ingestAndSave(incoming) {
  const [existing, shoes] = await Promise.all([getAll('exercises'), getAll('shoes')]);
  const { toSave, updatedExisting, counts } = ingest(incoming, { existing, shoes });

  const writes = [...toSave, ...updatedExisting];
  if (writes.length > 0) await putMany('exercises', writes);

  return { counts, newIds: toSave.map((e) => e.id) };
}
