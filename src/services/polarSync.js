import { getExercises, polarFetch } from './polarApi.js';
import { appendToCache } from './exerciseCache.js';

/**
 * Pull every new exercise from Polar into the server-side cache.
 *
 * The only place the two Polar sources are combined:
 * 1. Pull Notifications (transaction flow) — one-time consumption, so every
 *    exercise is cached whatever its sport. The running sport filter lives on
 *    the frontend; filtering here would lose the others for good.
 * 2. Training Data API — tops up exercises the transaction did not hand over.
 *    A failure here is logged, not thrown: the transaction is already committed
 *    and its exercises cached.
 *
 * Returns how many exercises each source returned and how many were new.
 */
export async function syncFromPolar({ accessToken, userId }) {
  const transactionExercises = await getExercises(accessToken, userId);
  let added = 0;
  if (transactionExercises.length > 0) {
    added += await appendToCache(transactionExercises);
  }

  let fromTrainingApi = 0;
  try {
    const trainingExercises = await polarFetch(accessToken, '/exercises');
    fromTrainingApi = trainingExercises.length;
    if (fromTrainingApi > 0) {
      const addedFromTrainingApi = await appendToCache(trainingExercises);
      if (addedFromTrainingApi > 0) {
        console.log(`[Polar] Added ${addedFromTrainingApi} exercises from Training Data API`);
      }
      added += addedFromTrainingApi;
    }
  } catch (err) {
    console.log('[Polar] Training Data API unavailable:', err.message);
  }

  return { fromTransaction: transactionExercises.length, fromTrainingApi, added };
}
