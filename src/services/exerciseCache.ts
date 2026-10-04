import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Exercise } from '../../types/domain.ts';
import { DATA_DIR } from '../config.ts';

const CACHE_PATH = join(DATA_DIR, 'exercises.json');
const DELETED_PATH = join(DATA_DIR, 'deletedExercises.json');

export async function readCache(): Promise<Exercise[]> {
  try {
    const data = await readFile(CACHE_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function writeCache(exercises: Exercise[]): Promise<void> {
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(exercises, null, 2));
}

/**
 * Append new exercises to cache, skipping duplicates by id.
 * Returns the count of newly added exercises.
 */
export async function appendToCache(newExercises: Exercise[]): Promise<number> {
  const existing = await readCache();
  const existingIds = new Set(existing.map((e) => e.id));
  const unique = newExercises.filter((e) => !existingIds.has(e.id));
  if (unique.length > 0) {
    await writeCache([...existing, ...unique]);
  }
  return unique.length;
}

/**
 * Take an exercise just appended back out of the cache, without recording it
 * as deleted: for an import whose TCX could not be written after all.
 */
export async function revertAppend(id: string): Promise<void> {
  const existing = await readCache();
  const remaining = existing.filter((e) => e.id !== id);
  if (remaining.length < existing.length) await writeCache(remaining);
}

/**
 * Remove an exercise from the cache and remember its id as deleted, so a sync
 * does not bring it back from the Training Data API. Its TCX/GPX and heart
 * rate sensor entry are kept: they cannot be fetched again.
 * Returns false when the id was not cached.
 */
export async function removeFromCache(id: string): Promise<boolean> {
  const existing = await readCache();
  const remaining = existing.filter((e) => String(e.id) !== String(id));
  if (remaining.length === existing.length) return false;

  await writeCache(remaining);
  const deleted = await readDeletedIds();
  deleted.add(String(id));
  await writeFile(DELETED_PATH, JSON.stringify([...deleted], null, 2));
  return true;
}

/** Ids of exercises deleted by the user, as strings. */
export async function readDeletedIds(): Promise<Set<string>> {
  try {
    return new Set<string>(JSON.parse(await readFile(DELETED_PATH, 'utf-8')));
  } catch {
    return new Set<string>();
  }
}
