import { config } from '../config.js';

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

/**
 * Fetch exercises using the Polar AccessLink transaction flow:
 * 1. POST /v3/users/{userId}/exercise-transactions  -> creates transaction
 * 2. GET  the transaction resource-uri               -> lists exercise URLs
 * 3. GET  each exercise URL                          -> exercise data
 * 4. PUT  the transaction resource-uri               -> commits transaction
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

    // Step 3: Fetch each exercise
    const exercises = [];
    for (const url of exerciseUrls) {
      try {
        const res = await fetch(url, { headers: headers(accessToken) });
        if (res.ok) {
          exercises.push(await res.json());
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
