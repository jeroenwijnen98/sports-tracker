/**
 * Standalone sync script — pulls exercises from Polar into the server-side
 * JSON cache, the same way /api/exercises does.
 * Runs without the Express server, used by sleepwatcher.
 */

import 'dotenv/config';
import { getToken } from '../src/services/tokenStore.ts';
import { syncFromPolar } from '../src/services/polarSync.ts';
import { readCache } from '../src/services/exerciseCache.ts';

async function main() {
  const token = await getToken();
  if (!token?.access_token) {
    console.log('[sync] No token found — skipping');
    return;
  }

  console.log('[sync] Fetching exercises from Polar...');
  const { fromTransaction, fromTrainingApi, added } = await syncFromPolar({
    accessToken: token.access_token,
    userId: token.x_user_id,
  });

  const cached = await readCache();
  console.log(
    `[sync] ${fromTransaction} from transaction, ${fromTrainingApi} from Training Data API; ` +
    `added ${added} new exercises to cache (${cached.length} total)`
  );
}

main().catch((err) => {
  console.error('[sync] Error:', err.message);
  process.exit(1);
});
