import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '..', 'data', 'exercises.json');

export async function readCache() {
  try {
    const data = await readFile(CACHE_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function writeCache(exercises) {
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(exercises, null, 2));
}

/**
 * Append new exercises to cache, skipping duplicates by id.
 * Returns the count of newly added exercises.
 */
export async function appendToCache(newExercises) {
  const existing = await readCache();
  const existingIds = new Set(existing.map((e) => e.id));
  const unique = newExercises.filter((e) => !existingIds.has(e.id));
  if (unique.length > 0) {
    await writeCache([...existing, ...unique]);
  }
  return unique.length;
}
