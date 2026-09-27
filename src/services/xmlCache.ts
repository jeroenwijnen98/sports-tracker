import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '../config.ts';
import { recordHrSensor } from './hrSensor.ts';

/** The two kinds of exercise XML kept on disk, each in its own directory. */
export type XmlType = 'tcx' | 'gpx';

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
 * Write XML (TCX/GPX) to the server-side cache.
 *
 * TCX is the only place the heart rate series is kept, and it is written from
 * four different call sites, so the sensor classification hangs off this choke
 * point rather than off each of them. It is best effort: a failure here must
 * never cost us the cached XML, which is the permanent record.
 */
export async function writeXmlCache(type: XmlType, exerciseId: string, xml: string): Promise<void> {
  const dir = join(DATA_DIR, type);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${exerciseId}.xml`), xml);

  if (type === 'tcx') {
    try {
      await recordHrSensor(exerciseId, xml);
    } catch (err) {
      console.log(`[sensors] Could not classify ${exerciseId}:`, (err as Error).message);
    }
  }
}
