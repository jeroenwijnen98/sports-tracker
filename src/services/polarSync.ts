import type { Exercise } from '../../types/domain.ts';
import { appendToCache, readCache, readDeletedIds } from './exerciseCache.ts';
import { consumeTransaction, diskStore } from './transactionConsumer.ts';
import type { PolarRequest } from './transactionConsumer.ts';

export interface SyncResult {
  /** Exercises the transaction handed over with their TCX/GPX all on disk. */
  fromTransaction: number;
  fromTrainingApi: number;
  added: number;
  /**
   * URLs the transaction consumer could not secure (the list, an exercise, or
   * its `/tcx` or `/gpx`). Not empty means the transaction was left open.
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
 * 2. Training Data API — tops up exercises the transaction did not hand over.
 *    A failure here is logged, not thrown: the transaction's exercises are
 *    already on disk.
 *
 * Exercises the user deleted are skipped from both sources (`diskStore` does
 * it for the transaction), or the Training Data API would hand a recent one
 * straight back.
 *
 * `request` is `polarRequest` with the token bound (`withToken`).
 */
export async function syncFromPolar(
  { request, userId }: { request: PolarRequest; userId: number },
): Promise<SyncResult> {
  const before = (await readCache()).length;
  const { secured, failed } = await consumeTransaction({ request, store: diskStore, userId });
  let added = (await readCache()).length - before;

  let fromTrainingApi = 0;
  try {
    const trainingExercises: Exercise[] = await (await request('/exercises')).json();
    fromTrainingApi = trainingExercises.length;
    const deletedIds = await readDeletedIds();
    const addedFromTrainingApi = await appendToCache(trainingExercises.filter((e) => !deletedIds.has(String(e.id))));
    if (addedFromTrainingApi > 0) {
      console.log(`[Polar] Added ${addedFromTrainingApi} exercises from Training Data API`);
    }
    added += addedFromTrainingApi;
  } catch (err) {
    console.log('[Polar] Training Data API unavailable:', (err as Error).message);
  }

  return { fromTransaction: secured.length, fromTrainingApi, added, failed };
}
