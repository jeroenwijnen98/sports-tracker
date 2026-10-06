import { writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname } from 'node:path';

/**
 * A file in the archive that exists but cannot be read as what it should
 * hold. Thrown rather than read as empty, so no caller overwrites the record
 * with less than it held.
 */
export class CorruptCacheError extends Error {
  constructor(path: string, reason: string) {
    super(`${basename(path)} is unreadable (${reason}); left on disk untouched`);
    this.name = 'CorruptCacheError';
  }
}

/**
 * Write through a temporary file in the same directory, then rename it into
 * place: a write cut off mid-way leaves the old file, never half of a new one.
 */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
