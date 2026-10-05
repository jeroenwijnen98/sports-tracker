import type { Exercise } from '../../types/domain.ts';
import { XML_ACCEPT } from './polarApi.ts';
import type { PolarRequestOptions } from './polarApi.ts';
import { appendToCache, readDeletedIds } from './exerciseCache.ts';
import { readXmlCache, writeXmlCache } from './xmlCache.ts';
import type { XmlType } from './xmlCache.ts';

/** `polarRequest` with the access token already bound. */
export type PolarRequest = (url: string, options?: PolarRequestOptions) => Promise<Response>;

/** Where the consumer secures what a transaction hands over. */
export interface TransactionStore {
  /** Write the exercise JSON; an exercise already stored is left as it is. */
  saveExercise(exercise: Exercise): Promise<void>;
  hasXml(type: XmlType, exerciseId: string): Promise<boolean>;
  writeXml(type: XmlType, exerciseId: string, xml: string): Promise<void>;
}

export interface ConsumeResult {
  /** Exercises whose JSON, TCX and (with a route) GPX are all on disk. */
  secured: Exercise[];
  /** The URLs that failed: the list, an exercise, or an exercise's `/tcx` or `/gpx`. */
  failed: string[];
}

/**
 * The real store: the exercise cache plus the XML cache.
 *
 * It, not the consumer, skips exercises the user deleted, so no writer of the
 * exercise cache can bring one back. Skipping one counts as secured: the user
 * chose not to keep it, so it must not hold the transaction open.
 */
export const diskStore: TransactionStore = {
  async saveExercise(exercise) {
    if ((await readDeletedIds()).has(exercise.id)) return;
    await appendToCache([exercise]);
  },
  async hasXml(type, exerciseId) {
    return (await readXmlCache(type, exerciseId)) !== null;
  },
  async writeXml(type, exerciseId, xml) {
    await writeXmlCache(type, exerciseId, xml);
  },
};

/**
 * Consume one Pull Notifications transaction:
 * 1. POST /users/{userId}/exercise-transactions -> opens it (204: no new data)
 * 2. GET  its resource-uri                      -> lists exercise URLs
 * 3. GET  each exercise URL, then {url}/tcx and, with a route, {url}/gpx,
 *         writing each to `store` as it arrives (XML already cached is not
 *         fetched again)
 * 4. PUT  its resource-uri                      -> commits; Polar deletes it
 *
 * Invariant: every exercise in the transaction, with its TCX and GPX, is on
 * disk before the commit, because Polar never hands it out again. When
 * anything fails the transaction is left open, not committed, and the failed
 * URLs are returned, so the next sync gets the same exercises again (the
 * partial-failure policy in CLAUDE.md). What did arrive is still written.
 */
export async function consumeTransaction(
  { request, store, userId }: { request: PolarRequest; store: TransactionStore; userId: number },
): Promise<ConsumeResult> {
  const createRes = await request(`/users/${userId}/exercise-transactions`, { method: 'POST' });
  if (createRes.status === 204) return { secured: [], failed: [] };

  const transaction: { 'resource-uri': string } = await createRes.json();
  const listUrl = transaction['resource-uri'];

  let exerciseUrls: string[];
  try {
    const listData: { exercises?: string[] } = await (await request(listUrl)).json();
    exerciseUrls = listData.exercises || [];
  } catch (err) {
    console.log(`[Polar] Listing transaction ${listUrl} failed:`, (err as Error).message);
    return { secured: [], failed: [listUrl] };
  }

  const secured: Exercise[] = [];
  const failed: string[] = [];

  for (const url of exerciseUrls) {
    let exercise: Exercise;
    try {
      exercise = await (await request(url)).json();
      await store.saveExercise(exercise);
    } catch (err) {
      console.log(`[Polar] Exercise ${url} failed:`, (err as Error).message);
      failed.push(url);
      continue;
    }

    const types: XmlType[] = exercise['has-route'] ? ['tcx', 'gpx'] : ['tcx'];
    let complete = true;
    for (const type of types) {
      try {
        if (await store.hasXml(type, exercise.id)) continue;
        const xml = await (await request(`${url}/${type}`, { accept: XML_ACCEPT[type] })).text();
        await store.writeXml(type, exercise.id, xml);
      } catch (err) {
        console.log(`[Polar] ${type.toUpperCase()} for ${url} failed:`, (err as Error).message);
        failed.push(`${url}/${type}`);
        complete = false;
      }
    }
    if (complete) secured.push(exercise);
  }

  // Commit only what is secured: one failure keeps the whole transaction open
  if (failed.length > 0) {
    console.log(`[Polar] ${failed.length} fetches failed; transaction ${listUrl} left open for the next sync`);
    return { secured, failed };
  }

  // Everything is on disk, so a failed commit loses nothing: the next sync
  // gets the same exercises again and finds them stored
  await request(listUrl, { method: 'PUT' })
    .catch((err) => console.log('[Polar] Commit failed:', (err as Error).message));

  return { secured, failed };
}
