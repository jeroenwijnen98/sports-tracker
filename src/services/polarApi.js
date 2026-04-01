import { config } from '../config.js';
import { readXmlCache, writeXmlCache } from './xmlCache.js';

const API = config.polar.apiBase;

function headers(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
}

export async function polarFetch(accessToken, path) {
  const res = await fetch(`${API}${path}`, { headers: headers(accessToken) });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Polar API error: ${res.status} ${text}`);
  }

  return res.json();
}

export async function polarFetchRaw(accessToken, path, accept = 'application/vnd.garmin.tcx+xml') {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: accept,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Polar API error: ${res.status} ${text}`);
  }

  return res.text();
}

/**
 * Fetch TCX/GPX for an exercise during a transaction.
 * Uses the transaction exercise URL + /tcx or /gpx suffix.
 * This data is ONLY available before the transaction is committed.
 */
async function fetchExerciseXml(accessToken, exerciseUrl, type) {
  const accept = type === 'tcx'
    ? 'application/vnd.garmin.tcx+xml'
    : 'application/gpx+xml';

  try {
    const res = await fetch(`${exerciseUrl}/${type}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: accept },
    });
    if (res.ok) return res.text();
    console.log(`[Polar] ${type.toUpperCase()} fetch for ${exerciseUrl}: ${res.status}`);
  } catch (err) {
    console.log(`[Polar] ${type.toUpperCase()} fetch error:`, err.message);
  }
  return null;
}

/**
 * Fetch exercises using the Polar AccessLink transaction flow:
 * 1. POST /v3/users/{userId}/exercise-transactions  -> creates transaction
 * 2. GET  the transaction resource-uri               -> lists exercise URLs
 * 3. GET  each exercise URL                          -> exercise data + TCX/GPX
 * 4. PUT  the transaction resource-uri               -> commits transaction
 *
 * TCX/GPX are eagerly fetched via {exerciseUrl}/tcx during step 3 (before commit)
 * and cached server-side, because they become inaccessible after commit.
 */
export async function getExercises(accessToken, userId) {
  // Step 1: Create transaction
  const createRes = await fetch(
    `${API}/users/${userId}/exercise-transactions`,
    { method: 'POST', headers: headers(accessToken) }
  );

  console.log(`[Polar] Create transaction: ${createRes.status}`);

  // 204 = no new data available
  if (createRes.status === 204) {
    console.log('[Polar] No new exercise data available (204)');
    return [];
  }

  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Create transaction failed: ${createRes.status} ${text}`);
  }

  const transaction = await createRes.json();
  const listUrl = transaction['resource-uri'];

  try {
    // Step 2: List exercises in transaction
    const listRes = await fetch(listUrl, { headers: headers(accessToken) });
    if (!listRes.ok) {
      throw new Error(`List exercises failed: ${listRes.status}`);
    }

    const listData = await listRes.json();
    const exerciseUrls = listData.exercises || [];
    console.log(`[Polar] Found ${exerciseUrls.length} exercises in transaction`);

    // Step 3: Fetch each exercise + eagerly grab TCX/GPX before commit
    const exercises = [];
    for (const url of exerciseUrls) {
      try {
        const res = await fetch(url, { headers: headers(accessToken) });
        if (!res.ok) continue;

        const exercise = await res.json();
        exercises.push(exercise);

        // Eagerly fetch and cache TCX/GPX while transaction is open
        const id = exercise.id;
        if (!await readXmlCache('tcx', id)) {
          const tcx = await fetchExerciseXml(accessToken, url, 'tcx');
          if (tcx) {
            await writeXmlCache('tcx', id, tcx);
            console.log(`[Polar] Cached TCX for exercise ${id}`);
          }
        }
        if (exercise['has-route'] && !await readXmlCache('gpx', id)) {
          const gpx = await fetchExerciseXml(accessToken, url, 'gpx');
          if (gpx) {
            await writeXmlCache('gpx', id, gpx);
            console.log(`[Polar] Cached GPX for exercise ${id}`);
          }
        }
      } catch {
        // Skip failed individual fetches
      }
    }

    // Step 4: Commit transaction
    await fetch(listUrl, { method: 'PUT', headers: headers(accessToken) });

    return exercises;
  } catch (err) {
    // Try to commit even on error so the transaction doesn't block future ones
    try {
      await fetch(listUrl, { method: 'PUT', headers: headers(accessToken) });
    } catch {}
    throw err;
  }
}
