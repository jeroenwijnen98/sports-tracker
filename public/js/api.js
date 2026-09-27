// @ts-check

/** @typedef {import('../../types/domain.ts').Exercise} Exercise */

/**
 * An exercise the import routes hand back. `_duplicate` marks one the server
 * already had (a 409), which is not imported again.
 * @typedef {Exercise & { _duplicate?: true }} ImportedExercise
 */

/**
 * @typedef {RequestInit & { duplicate?: boolean, headers?: Record<string, string> }} RequestOptions
 */

/**
 * Fetch a backend route as JSON. A 401 reloads the page to show the login.
 * With `duplicate: true`, a 409 resolves to the exercise the server already
 * has, flagged `_duplicate`, instead of throwing.
 *
 * @param {string} path
 * @param {RequestOptions} [options]
 * @returns {Promise<any>} The parsed body; each caller below states its shape.
 */
async function request(path, { duplicate = false, headers, ...options } = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

  if (res.status === 401) {
    window.location.reload();
    throw new Error('Not authenticated');
  }

  if (duplicate && res.status === 409) {
    const data = await res.json();
    return { ...data.exercise, _duplicate: true };
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

/** @returns {Promise<{ authenticated: boolean }>} */
export function getAuthStatus() {
  return request('/auth/status');
}

/** @returns {Promise<{ ok: boolean }>} */
export function logout() {
  return request('/auth/logout', { method: 'POST' });
}

/** @returns {Promise<Exercise[]>} */
export function getExercises() {
  return request('/api/exercises');
}

/** @returns {Promise<Exercise[]>} */
export function getCachedExercises() {
  return request('/api/exercises/cached');
}

/**
 * Delete an exercise from the server-side cache. A 404 means the server never
 * had it (a local-only exercise), which counts as deleted.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteExercise(id) {
  const res = await fetch(`/api/exercises/${encodeURIComponent(id)}`, { method: 'DELETE' });

  if (res.status === 401) {
    window.location.reload();
    throw new Error('Not authenticated');
  }

  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Delete failed: ${res.status}`);
  }
}

/**
 * @param {string} id
 * @returns {Promise<string | null>} The TCX, or null when the server has none.
 */
export async function getExerciseTcx(id) {
  try {
    const res = await fetch(`/api/exercises/${id}/tcx`);
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

/**
 * @param {string} xmlString
 * @returns {Promise<ImportedExercise>}
 */
export function importExerciseTcx(xmlString) {
  return request('/api/exercises/import', {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xmlString,
    duplicate: true,
  });
}

/**
 * @param {unknown} jsonData A Polar data export training session.
 * @returns {Promise<ImportedExercise>}
 */
export function importExerciseJson(jsonData) {
  return request('/api/exercises/import-json', {
    method: 'POST',
    body: JSON.stringify(jsonData),
    duplicate: true,
  });
}

/**
 * @param {string} id
 * @returns {Promise<string | null>} The GPX, or null when the server has none.
 */
export async function getExerciseGpx(id) {
  try {
    const res = await fetch(`/api/exercises/${id}/gpx`);
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}
