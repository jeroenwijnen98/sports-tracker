// @ts-check

import { get, put, del } from '../db.js';
import { getExerciseTcx, getExerciseGpx } from '../api.js';
import { readDetail } from '../utils/detailReader.js';

/** @typedef {import('../../../types/domain.ts').DetailData} DetailData */
/** @typedef {import('../db.js').DetailsEntry} DetailsEntry */

/**
 * Where detail data is kept, keyed by exercise id. Never the exercises store:
 * a load that finishes after its exercise was deleted must not bring it back.
 * @typedef {object} DetailsStore
 * @property {(id: string) => Promise<DetailsEntry | undefined>} get
 * @property {(entry: DetailsEntry) => Promise<unknown>} put
 * @property {(id: string) => Promise<unknown>} delete
 */

/**
 * @typedef {object} DetailLoaderDeps
 * @property {DetailsStore} store
 * @property {(id: string) => Promise<string | null>} fetchTcx The TCX, or
 *   null when there is none.
 * @property {(id: string) => Promise<string | null>} fetchGpx The GPX, or
 *   null when there is none.
 * @property {() => number} [now]
 */

/** How long an unavailable marker holds before the next load tries again. */
export const RETRY_AFTER_MS = 60 * 60 * 1000; // 1 hour

/**
 * Build `load` and `forget` around a store and fetchers, so Node tests can
 * inject both.
 *
 * @param {DetailLoaderDeps} deps
 */
export function createDetailLoader({ store, fetchTcx, fetchGpx, now = Date.now }) {
  /** @type {Map<string, Promise<DetailData | null>>} */
  const inFlight = new Map();

  /**
   * @param {string} id
   * @returns {Promise<DetailData | null>}
   */
  async function fetchAndStore(id) {
    // GPX only when there is no TCX: it has the route only
    const tcx = await fetchTcx(id);
    const gpx = tcx ? null : await fetchGpx(id);
    const detail = readDetail({ tcx, gpx });
    if (detail) {
      await store.put({ id, detail });
      return detail;
    }

    // Neither: mark it unavailable so it is only retried after the TTL
    await store.put({ id, unavailable: true, checkedAt: now() });
    return null;
  }

  /**
   * Detail data for one exercise: from the store, or fetched and stored.
   * Null when there is none, without a fetch while an unavailable marker is
   * younger than the TTL; `force` (the retry button) ignores the marker.
   * Concurrent loads of the same id share one fetch.
   *
   * @param {string} id
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<DetailData | null>}
   */
  async function load(id, { force = false } = {}) {
    const pending = inFlight.get(id);
    if (pending) return pending;

    const promise = (async () => {
      const entry = await store.get(id);
      if (entry && 'detail' in entry) return entry.detail;
      if (entry && !force && now() - entry.checkedAt < RETRY_AFTER_MS) return null;
      return fetchAndStore(id);
    })();

    inFlight.set(id, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(id);
    }
  }

  /**
   * Remove an exercise's details entry, once a load of it still in flight
   * has written its own, so a deleted exercise leaves nothing behind.
   *
   * @param {string} id
   * @returns {Promise<void>}
   */
  async function forget(id) {
    await inFlight.get(id)?.catch(() => {});
    await store.delete(id);
  }

  return { load, forget };
}

export const { load, forget } = createDetailLoader({
  store: {
    get: (id) => get('details', id),
    put: (entry) => put('details', entry),
    delete: (id) => del('details', id),
  },
  fetchTcx: getExerciseTcx,
  fetchGpx: getExerciseGpx,
});
