// @ts-check

import { get, put } from '../db.js';
import { getExerciseTcx, getExerciseGpx } from '../api.js';
import { parseTcx } from '../utils/tcxParser.js';
import { parseGpx } from '../utils/gpxParser.js';

/** @typedef {import('../../../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../../../types/domain.ts').DetailData} DetailData */

const RETRY_AFTER_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get detailed data (trackpoints, laps, route) for an exercise.
 * Checks IndexedDB cache first, then fetches from Polar API.
 * Returns the detail data object, or null if unavailable.
 *
 * @param {string} exerciseId
 * @returns {Promise<DetailData | null>}
 */
export async function getDetailData(exerciseId) {
  const exercise = await get('exercises', exerciseId);
  if (!exercise) return null;

  // Return cached data (retry unavailable entries after TTL)
  if (exercise.detailData) {
    if (!('unavailable' in exercise.detailData)) return exercise.detailData;
    // Markers written before the rename carry `timestamp` instead of `checkedAt`
    const { checkedAt, timestamp } = exercise.detailData;
    const age = Date.now() - (checkedAt ?? timestamp ?? 0);
    if (age < RETRY_AFTER_MS) return null;
  }

  return fetchAndCacheDetail(exercise);
}

/**
 * Force-retry fetching detail data, ignoring any cached unavailable state.
 *
 * @param {string} exerciseId
 * @returns {Promise<DetailData | null>}
 */
export async function retryDetailData(exerciseId) {
  const exercise = await get('exercises', exerciseId);
  if (!exercise) return null;
  delete exercise.detailData;
  return fetchAndCacheDetail(exercise);
}

/**
 * @param {Exercise} exercise
 * @returns {Promise<DetailData | null>}
 */
async function fetchAndCacheDetail(exercise) {
  // Try TCX
  const tcxXml = await getExerciseTcx(exercise.id);
  if (tcxXml) {
    const data = parseTcx(tcxXml);
    exercise.detailData = data;
    await put('exercises', exercise);
    return data;
  }

  // Fallback: try GPX for map-only data
  const gpxXml = await getExerciseGpx(exercise.id);
  if (gpxXml) {
    /** @type {DetailData} */
    const data = {
      ...parseGpx(gpxXml),
      laps: [],
      allTrackpoints: [],
      hasHeartRate: false,
      hasSpeed: false,
    };
    exercise.detailData = data;
    await put('exercises', exercise);
    return data;
  }

  // Both failed — mark as unavailable so it is only retried after the TTL
  exercise.detailData = { unavailable: true, checkedAt: Date.now() };
  await put('exercises', exercise);
  return null;
}

/**
 * Eagerly fetch and cache detail data for a list of exercise IDs.
 * Fire-and-forget; errors are silently ignored.
 *
 * @param {string[]} ids
 */
export async function backgroundFetchDetails(ids) {
  for (const id of ids) {
    try {
      await getDetailData(id);
    } catch {
      // ignore
    }
  }
}
