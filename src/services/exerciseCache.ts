import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Exercise } from '../../types/domain.ts';
import { DATA_DIR } from '../config.ts';
import { CorruptCacheError, writeFileAtomic } from './atomicFile.ts';
import { createWriteLock } from './writeLock.ts';

export { CorruptCacheError } from './atomicFile.ts';

const CACHE_PATH = join(DATA_DIR, 'exercises.json');
const DELETED_PATH = join(DATA_DIR, 'deletedExercises.json');

/**
 * Every read-modify-write of either file runs through this, one at a time in
 * this process and never at the same time as `scripts/sync.ts` or the server
 * in another: two interleaved cycles would drop one side's exercises.
 */
const writes = createWriteLock(join(DATA_DIR, 'exercises.lock'));

/** A JSON array file: missing reads as empty, anything unparseable throws. */
async function readJsonArray<T>(path: string): Promise<T[]> {
  let data: string;
  try {
    data = await readFile(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    throw new CorruptCacheError(path, (err as Error).message);
  }
  if (!Array.isArray(parsed)) throw new CorruptCacheError(path, 'not an array');
  return parsed;
}

/** Write a JSON value through `writeFileAtomic`. */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(value, null, 2));
}

export async function readCache(): Promise<Exercise[]> {
  return readJsonArray<Exercise>(CACHE_PATH);
}

/**
 * Append new exercises to cache, skipping duplicates by id and, with
 * `skipDeleted`, exercises the user deleted. The deleted ids are read under
 * the same lock, so a delete cannot slip in between the check and the write.
 * Returns the count of newly added exercises.
 */
export async function appendToCache(
  newExercises: Exercise[],
  { skipDeleted = false }: { skipDeleted?: boolean } = {},
): Promise<number> {
  return writes.run(async () => {
    const existing = await readCache();
    const skipped = new Set(existing.map((e) => String(e.id)));
    if (skipDeleted) for (const id of await readDeletedIds()) skipped.add(id);
    const unique = newExercises.filter((e) => !skipped.has(String(e.id)));
    if (unique.length > 0) {
      await writeJsonAtomic(CACHE_PATH, [...existing, ...unique]);
    }
    return unique.length;
  });
}

/**
 * Take an exercise just appended back out of the cache, without recording it
 * as deleted: for an import whose TCX could not be written after all.
 */
export async function revertAppend(id: string): Promise<void> {
  await writes.run(async () => {
    const existing = await readCache();
    const remaining = existing.filter((e) => e.id !== id);
    if (remaining.length < existing.length) await writeJsonAtomic(CACHE_PATH, remaining);
  });
}

/**
 * Remove an exercise from the cache and remember its id as deleted, so a sync
 * does not bring it back from the Training Data API. Its TCX/GPX and heart
 * rate sensor entry are kept: they cannot be fetched again.
 * Returns false when the id was not cached.
 *
 * Both files are read before either is written, so an unreadable one leaves
 * both untouched. The deleted id is written first: should the cache write then
 * fail, the exercise is still listed but no sync can bring it back.
 */
export async function removeFromCache(id: string): Promise<boolean> {
  return writes.run(async () => {
    const existing = await readCache();
    const deleted = await readDeletedIds();
    const remaining = existing.filter((e) => String(e.id) !== String(id));
    if (remaining.length === existing.length) return false;

    deleted.add(String(id));
    await writeJsonAtomic(DELETED_PATH, [...deleted]);
    await writeJsonAtomic(CACHE_PATH, remaining);
    return true;
  });
}

/** Ids of exercises deleted by the user, as strings. */
export async function readDeletedIds(): Promise<Set<string>> {
  return new Set((await readJsonArray<unknown>(DELETED_PATH)).map(String));
}
