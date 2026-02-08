/**
 * Standalone sync script — fetches exercises from Polar API
 * and saves them to the server-side JSON cache.
 * Runs without the Express server, used by sleepwatcher.
 */

import 'dotenv/config';
import { getToken } from '../src/services/tokenStore.js';
import { getExercises } from '../src/services/polarApi.js';
import { appendToCache, readCache } from '../src/services/exerciseCache.js';

const RUNNING_SPORTS = ['RUNNING', 'TRAIL_RUNNING', 'TREADMILL_RUNNING'];

async function main() {
  const token = await getToken();
  if (!token?.access_token) {
    console.log('[sync] No token found — skipping');
    return;
  }

  console.log('[sync] Fetching exercises from Polar...');
  const exercises = await getExercises(token.access_token, token.x_user_id);

  if (exercises.length === 0) {
    const cached = await readCache();
    console.log(`[sync] No new exercises from Polar (${cached.length} in cache)`);
    return;
  }

  // Filter to running sports
  const running = exercises.filter((ex) =>
    RUNNING_SPORTS.includes(ex['detailed-sport-info'])
  );

  console.log(`[sync] Fetched ${exercises.length} exercises, ${running.length} running`);

  const added = await appendToCache(running);
  const cached = await readCache();
  console.log(`[sync] Added ${added} new exercises to cache (${cached.length} total)`);
}

main().catch((err) => {
  console.error('[sync] Error:', err.message);
  process.exit(1);
});
