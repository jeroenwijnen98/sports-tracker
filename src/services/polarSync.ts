import type { Exercise } from '../../types/domain.ts';
import { appendToCache, readCache, readDeletedIds } from './exerciseCache.ts';
import { XML_ACCEPT } from './polarApi.ts';
import { consumeTransaction, diskStore } from './transactionConsumer.ts';
import type { PolarRequest } from './transactionConsumer.ts';
import type { XmlType } from './xmlCache.ts';

export interface SyncResult {
  /** Exercises the transaction handed over with their TCX/GPX all on disk. */
  fromTransaction: number;
  fromTrainingApi: number;
  added: number;
  /**
   * Every fetch the sync could not secure. A full transaction URL (the list,
   * an exercise, or its `/tcx` or `/gpx`) means the transaction was left open.
   * A Training Data API path (`/exercises/{id}/tcx` or `/gpx`) is detail data
   * of an exercise the top-up added or backfilled: its JSON is cached all the
   * same, and it does not hold the transaction open.
   */
  failed: string[];
}

/**
 * Pull every new exercise from Polar into the server-side cache.
 *
 * The only place the two Polar sources are combined:
 * 1. Pull Notifications, through `consumeTransaction()`, which owns the
 *    transaction: it writes every exercise, whatever its sport, with its
 *    TCX/GPX to disk and commits only when all of it is secured. The running
 *    sport filter lives on the frontend; filtering here would lose the others
 *    for good.
 * 2. Training Data API — tops up exercises the transaction did not hand over,
 *    and secures the TCX/GPX (`secureDetailData`) of every exercise it lists,
 *    which it serves for 30 days only. That also backfills a cached exercise
 *    whose XML never reached disk; one the API no longer lists is past its
 *    30 days and is not attempted. A failed list is logged, not thrown: the
 *    transaction's exercises are already on disk.
 *
 * Exercises the user deleted are skipped from both sources (`diskStore` does
 * it for the transaction), or the Training Data API would hand a recent one
 * straight back.
 *
 * Both files are read before the transaction is opened: an unreadable cache
 * or deleted-exercise list throws here, so the sync fails with nothing
 * consumed and nothing overwritten.
 *
 * `request` is `polarRequest` with the token bound (`withToken`).
 */
export async function syncFromPolar(
  { request, userId }: { request: PolarRequest; userId: number },
): Promise<SyncResult> {
  const before = (await readCache()).length;
  const deletedIds = await readDeletedIds();
  const { secured, failed } = await consumeTransaction({ request, store: diskStore, userId });
  let added = (await readCache()).length - before;

  let fromTrainingApi = 0;
  try {
    const trainingExercises: Exercise[] = await (await request('/exercises')).json();
    fromTrainingApi = trainingExercises.length;
    const listed = trainingExercises.filter((e) => !deletedIds.has(String(e.id)));
    const cachedIds = new Set((await readCache()).map((e) => String(e.id)));
    const newExercises = listed.filter((e) => !cachedIds.has(String(e.id)));
    const addedFromTrainingApi = await appendToCache(newExercises);
    if (addedFromTrainingApi > 0) {
      console.log(`[Polar] Added ${addedFromTrainingApi} exercises from Training Data API`);
    }
    added += addedFromTrainingApi;
    // Every listed exercise, not only the new ones: one already cached whose
    // TCX/GPX never reached disk is backfilled while Polar still serves it
    failed.push(...await secureDetailData(request, listed));
  } catch (err) {
    console.log('[Polar] Training Data API unavailable:', (err as Error).message);
  }

  return { fromTransaction: secured.length, fromTrainingApi, added, failed };
}

/**
 * Write each exercise's TCX and, with a route, its GPX from the Training Data
 * API to the XML cache, which classifies the heart rate sensor. XML already on
 * disk is not fetched again. One failure does not stop the others.
 * Returns the paths that failed.
 */
async function secureDetailData(request: PolarRequest, exercises: Exercise[]): Promise<string[]> {
  const failed: string[] = [];
  for (const exercise of exercises) {
    const types: XmlType[] = exercise['has-route'] ? ['tcx', 'gpx'] : ['tcx'];
    for (const type of types) {
      const path = `/exercises/${exercise.id}/${type}`;
      try {
        if (await diskStore.hasXml(type, exercise.id)) continue;
        const xml = await (await request(path, { accept: XML_ACCEPT[type] })).text();
        await diskStore.writeXml(type, exercise.id, xml);
      } catch (err) {
        console.log(`[Polar] ${type.toUpperCase()} for ${path} failed:`, (err as Error).message);
        failed.push(path);
      }
    }
  }
  return failed;
}
