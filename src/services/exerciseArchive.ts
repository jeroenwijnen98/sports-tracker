/**
 * The exercise archive: everything the server keeps in `src/data`, the
 * permanent record once a transaction is committed. Sync, import and the
 * routes reach the exercise cache, the XML cache and the heart rate sensor map
 * only through here, so the deleted rule and the heart rate sensor join each
 * live in one place.
 */

import type { Exercise, HeartRateSensor } from '../../types/domain.ts';
import { appendToCache, readCache, readDeletedIds, removeFromCache, revertAppend } from './exerciseCache.ts';
import { readXmlCache, writeXmlCache } from './xmlCache.ts';
import type { XmlType } from './xmlCache.ts';
import { readSensorCache, recordHrSensor } from './hrSensor.ts';
import type { SensorMap } from './hrSensor.ts';

export { CorruptCacheError } from './exerciseCache.ts';
export { isXmlType } from './xmlCache.ts';
export type { XmlType } from './xmlCache.ts';

/**
 * Where an exercise comes from. The two Polar sources are subject to the
 * deleted rule; a file import is not, so importing a deleted run on purpose
 * brings it back.
 */
export type ArchiveSource = 'transaction' | 'training-api' | 'import';

/**
 * Add exercises not stored yet. For a Polar source, an exercise the user
 * deleted is skipped, or the Training Data API would hand a recent one
 * straight back. Returns the count added.
 */
export async function addExercises(list: Exercise[], { source }: { source: ArchiveSource }): Promise<number> {
  return appendToCache(list, { skipDeleted: source !== 'import' });
}

/** Every stored exercise, with its heart rate sensor. */
export async function list(): Promise<Exercise[]> {
  return withHrSensor(await readCache());
}

/** The stored exercise with this id, with its heart rate sensor. */
export async function find(id: string): Promise<Exercise | undefined> {
  const found = (await readCache()).find((e) => String(e.id) === String(id));
  return found && (await withHrSensor([found]))[0];
}

/**
 * Remove an exercise and record it as deleted, so no Polar source brings it
 * back. Its TCX/GPX and heart rate sensor stay on disk. Returns false when
 * the id was not stored.
 */
export const remove: (id: string) => Promise<boolean> = removeFromCache;

/**
 * Take back an exercise just added, without recording it as deleted: an
 * import whose TCX could not be written.
 */
export const revert: (id: string) => Promise<void> = revertAppend;

/** Cached TCX/GPX, or null when it is not on disk. */
export const readXml: (type: XmlType, id: string) => Promise<string | null> = readXmlCache;

/**
 * Write TCX/GPX to disk. A TCX is the only place the heart rate series is
 * kept, so every write of one classifies the heart rate sensor. That is best
 * effort: a failure there must never cost us the XML, the permanent record.
 *
 * Returns the heart rate sensor just classified, or null when there is none
 * (a GPX, too little heart rate data, or a failed classification).
 */
export async function writeXml(type: XmlType, id: string, xml: string): Promise<HeartRateSensor | null> {
  await writeXmlCache(type, id, xml);
  if (type !== 'tcx') return null;
  try {
    return await recordHrSensor(id, xml);
  } catch (err) {
    console.log(`[sensors] Could not record the heart rate sensor of ${id}:`, (err as Error).message);
    return null;
  }
}

/**
 * Read both exercise files, so a caller about to do something it cannot undo
 * (open a transaction) fails first when one is unreadable.
 */
export async function verify(): Promise<void> {
  await readCache();
  await readDeletedIds();
}

/**
 * The one heart rate sensor join: each exercise gets its stored sensor, which
 * replaces any field it already carries, so it is attached once. The sensor is
 * only indicative, so an unreadable map is logged and the exercises go out
 * without one rather than not at all; intake keeps the sensor it already has.
 */
async function withHrSensor(exercises: Exercise[]): Promise<Exercise[]> {
  let map: SensorMap;
  try {
    map = await readSensorCache();
  } catch (err) {
    console.log('[sensors] Heart rate sensors left out:', (err as Error).message);
    return exercises;
  }
  return exercises.map((exercise) => {
    const sensor = map[exercise.id];
    return sensor ? { ...exercise, hrSensor: sensor } : exercise;
  });
}
