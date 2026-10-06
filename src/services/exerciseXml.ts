import { XML_ACCEPT } from './polarApi.ts';
import type { PolarRequest } from './transactionConsumer.ts';
import { isXmlType, readXmlCache, writeXmlCache } from './xmlCache.ts';

/**
 * What `GET /api/exercises/:id/:type` answers: the XML, a 404 when neither the
 * cache nor the Training Data API has it, or `not-xml` when `type` is neither
 * `tcx` nor `gpx`, so the route falls through to the next handler.
 */
export type ExerciseXml =
  | { status: 'found'; xml: string }
  | { status: 'unavailable' }
  | { status: 'not-xml' };

/**
 * An exercise's TCX or GPX, read from the server-side XML cache. Sync secures
 * detail data itself, so the Training Data API is only a last resort here: its
 * answer is written to the XML cache (which classifies the heart rate sensor)
 * and served, and a failure there means the XML is unavailable.
 *
 * `request` is `polarRequest` with the token bound (`withToken`).
 */
export async function readExerciseXml(request: PolarRequest, type: string, id: string): Promise<ExerciseXml> {
  if (!isXmlType(type)) return { status: 'not-xml' };

  const cached = await readXmlCache(type, id);
  if (cached) return { status: 'found', xml: cached };

  try {
    const xml = await (await request(`/exercises/${id}/${type}`, { accept: XML_ACCEPT[type] })).text();
    await writeXmlCache(type, id, xml);
    console.log(`[Polar] Fetched & cached ${type.toUpperCase()} for ${id} via Training Data API`);
    return { status: 'found', xml };
  } catch {
    // The Training Data API does not have it either
    return { status: 'unavailable' };
  }
}
