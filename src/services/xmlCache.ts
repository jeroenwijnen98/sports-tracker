import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '../config.ts';
import { writeFileAtomic } from './atomicFile.ts';

/** The two kinds of exercise XML kept on disk, each in its own directory. */
export type XmlType = 'tcx' | 'gpx';

/** Whether a route parameter names one of the XML types, so it can index by it. */
export function isXmlType(type: string): type is XmlType {
  return type === 'tcx' || type === 'gpx';
}

/**
 * Read cached XML (TCX/GPX) for an exercise.
 * Returns the XML string or null if not cached.
 */
export async function readXmlCache(type: XmlType, exerciseId: string): Promise<string | null> {
  try {
    return await readFile(join(DATA_DIR, type, `${exerciseId}.xml`), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write XML (TCX/GPX) to the server-side cache, through a temporary file and a
 * rename: a write cut off mid-way never leaves a truncated file that later
 * reads as detail data.
 */
export async function writeXmlCache(type: XmlType, exerciseId: string, xml: string): Promise<void> {
  await writeFileAtomic(join(DATA_DIR, type, `${exerciseId}.xml`), xml);
}
