// @ts-check

import { getAll, putMany } from './db.js';
import { isRunningSport } from './utils/sports.js';
import { markOverlaps } from './utils/overlap.js';
import { sameExercise } from './utils/identity.js';

/** @typedef {import('../../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../../types/domain.ts').Shoe} Shoe */

/**
 * What one intake did: how many exercises are new, how many were marked
 * overlap (new or already stored), how many were dropped as the same exercise
 * as one stored or one earlier in the batch under another id, and how many the
 * store holds afterwards.
 * @typedef {{ newExercises: number, overlaps: number, duplicates: number, total: number }} IntakeCounts
 */

/**
 * Drop each new exercise that is the same exercise as a stored one or as one
 * kept before it. Polar-synced exercises go first (`sort` is stable), so they
 * win over an imported copy whatever the batch order; the kept ones come back
 * in their original order.
 *
 * @param {Exercise[]} fresh
 * @param {Exercise[]} existing
 * @returns {{ unique: Exercise[], duplicates: number }}
 */
function dropSameExercises(fresh, existing) {
  const syncedFirst = [...fresh].sort((a, b) => Number(!!a.source) - Number(!!b.source));

  /** @type {Exercise[]} */
  const kept = [];
  for (const ex of syncedFirst) {
    const isCopy = existing.some((stored) => sameExercise(ex, stored)) || kept.some((k) => sameExercise(ex, k));
    if (!isCopy) kept.push(ex);
  }

  return {
    unique: fresh.filter((ex) => kept.includes(ex)),
    duplicates: fresh.length - kept.length,
  };
}

/**
 * The intake rules for every exercise entering the browser store. Pure: reads
 * its arguments, mutates none of them.
 *
 * - only running sports get in, and an id already stored is not new;
 * - an exercise that is the same exercise as a stored one, or as another one
 *   in the batch, under another id (see `sameExercise`) is not saved again but
 *   counted as a duplicate; the stored one stays as it is. Within a batch the
 *   copy synced from Polar wins over an imported one, so the order the two
 *   arrive in does not matter;
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

  const { unique, duplicates } = dropSameExercises([...fresh.values()], existing);
  const marked = markOverlaps(unique, existing);

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
      duplicates,
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
