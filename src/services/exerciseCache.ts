import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import type { Exercise } from '../../types/domain.ts';
import { DATA_DIR } from '../config.ts';

const CACHE_PATH = join(DATA_DIR, 'exercises.json');
const DELETED_PATH = join(DATA_DIR, 'deletedExercises.json');

/**
 * A cache file that exists but cannot be read as a JSON array. Thrown rather
 * than read as empty, so no caller overwrites the record with less than it
 * held.
 */
export class CorruptCacheError extends Error {
  constructor(path: string, reason: string) {
    super(`${basename(path)} is unreadable (${reason}); left on disk untouched`);
    this.name = 'CorruptCacheError';
  }
}

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

/**
 * Write through a temporary file in the same directory, then rename it into
 * place: a write cut off mid-way leaves the old file, never half of a new one.
 */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2));
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export async function readCache(): Promise<Exercise[]> {
  return readJsonArray<Exercise>(CACHE_PATH);
}

export async function writeCache(exercises: Exercise[]): Promise<void> {
  await writeJsonAtomic(CACHE_PATH, exercises);
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
 *
 * Both files are read before either is written, so an unreadable one leaves
 * both untouched. The deleted id is written first: should the cache write then
 * fail, the exercise is still listed but no sync can bring it back.
 */
export async function removeFromCache(id: string): Promise<boolean> {
  const existing = await readCache();
  const deleted = await readDeletedIds();
  const remaining = existing.filter((e) => String(e.id) !== String(id));
  if (remaining.length === existing.length) return false;

  deleted.add(String(id));
  await writeJsonAtomic(DELETED_PATH, [...deleted]);
  await writeCache(remaining);
  return true;
}

/** Ids of exercises deleted by the user, as strings. */
export async function readDeletedIds(): Promise<Set<string>> {
  return new Set((await readJsonArray<unknown>(DELETED_PATH)).map(String));
}
