import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

/**
 * Read cached XML (TCX/GPX) for an exercise.
 * Returns the XML string or null if not cached.
 */
export async function readXmlCache(type, exerciseId) {
  try {
    return await readFile(join(DATA_DIR, type, `${exerciseId}.xml`), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write XML (TCX/GPX) to the server-side cache.
 */
export async function writeXmlCache(type, exerciseId, xml) {
  const dir = join(DATA_DIR, type);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${exerciseId}.xml`), xml);
}
