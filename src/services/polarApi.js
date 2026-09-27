import { config } from '../config.js';
import { readXmlCache, writeXmlCache } from './xmlCache.js';

const API = config.polar.apiBase;

/** Accept header for each kind of exercise XML Polar serves. */
export const XML_ACCEPT = {
  tcx: 'application/vnd.garmin.tcx+xml',
  gpx: 'application/gpx+xml',
};

/**
 * Every AccessLink request goes through here. `url` is a path under the API
 * base (`/exercises`) or a full URL, such as a transaction's resource-uri.
 * Resolves to the Response, so the caller picks .json() or .text(); a non-2xx
 * status throws.
 */
export async function polarRequest(accessToken, url, { method = 'GET', accept = 'application/json', body } = {}) {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: accept };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url.startsWith('/') ? `${API}${url}` : url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Polar API error: ${res.status} ${text}`);
  }

  return res;
}

/**
 * Fetch TCX/GPX for an exercise during a transaction.
 * Uses the transaction exercise URL + /tcx or /gpx suffix.
 * This data is ONLY available before the transaction is committed.
 */
async function fetchExerciseXml(accessToken, exerciseUrl, type) {
  try {
    const res = await polarRequest(accessToken, `${exerciseUrl}/${type}`, { accept: XML_ACCEPT[type] });
    return await res.text();
  } catch (err) {
    console.log(`[Polar] ${type.toUpperCase()} fetch for ${exerciseUrl} failed:`, err.message);
    return null;
  }
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
  const createRes = await polarRequest(accessToken, `/users/${userId}/exercise-transactions`, { method: 'POST' });

  console.log(`[Polar] Create transaction: ${createRes.status}`);

  // 204 = no new data available
  if (createRes.status === 204) {
    console.log('[Polar] No new exercise data available (204)');
    return [];
  }

  const transaction = await createRes.json();
  const listUrl = transaction['resource-uri'];
  const commit = () => polarRequest(accessToken, listUrl, { method: 'PUT' });

  try {
    // Step 2: List exercises in transaction
    const listData = await (await polarRequest(accessToken, listUrl)).json();
    const exerciseUrls = listData.exercises || [];
    console.log(`[Polar] Found ${exerciseUrls.length} exercises in transaction`);

    // Step 3: Fetch each exercise + eagerly grab TCX/GPX before commit
    const exercises = [];
    for (const url of exerciseUrls) {
      try {
        const exercise = await (await polarRequest(accessToken, url)).json();
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
    await commit().catch((err) => console.log('[Polar] Commit failed:', err.message));

    return exercises;
  } catch (err) {
    // Try to commit even on error so the transaction doesn't block future ones
    try {
      await commit();
    } catch {}
    throw err;
  }
}
