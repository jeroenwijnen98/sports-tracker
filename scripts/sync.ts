/**
 * Standalone sync script — pulls exercises from Polar into the server-side
 * JSON cache, the same way /api/exercises does.
 * Runs without the Express server, used by sleepwatcher.
 */

import 'dotenv/config';
import { getToken } from '../src/services/tokenStore.ts';
import { syncFromPolar } from '../src/services/polarSync.ts';
import { withToken } from '../src/services/polarApi.ts';
import { readCache } from '../src/services/exerciseCache.ts';

async function main(): Promise<void> {
  const token = await getToken();
  if (!token?.access_token) {
    console.log('[sync] No token found — skipping');
    return;
  }

  console.log('[sync] Fetching exercises from Polar...');
  const { fromTransaction, fromTrainingApi, added, failed } = await syncFromPolar({
    request: withToken(token.access_token),
    userId: token.x_user_id,
  });

  const cached = await readCache();
  console.log(
    `[sync] ${fromTransaction} from transaction, ${fromTrainingApi} from Training Data API; ` +
    `added ${added} new exercises to cache (${cached.length} total)`
  );

  // run.sh appends this to logs/sync.log, so an open transaction shows up there
  if (failed.length > 0) {
    console.log(`[sync] Transaction left open, ${failed.length} failed; the next sync retries:`);
    for (const url of failed) console.log(`[sync]   failed: ${url}`);
  }
}

main().catch((err) => {
  console.error('[sync] Error:', err.message);
  process.exit(1);
});
