import { get, put, getAll } from '../db.js';
import { getExerciseTcx, getExerciseGpx } from '../api.js';
import { parseTcx } from '../utils/tcxParser.js';
import { parseGpx } from '../utils/gpxParser.js';

const RETRY_AFTER_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get detailed data (trackpoints, laps, route) for an exercise.
 * Checks IndexedDB cache first, then fetches from Polar API.
 * Returns the detail data object, or null if unavailable.
 */
export async function getDetailData(exerciseId) {
  const exercise = await get('exercises', exerciseId);
  if (!exercise) return null;

  // Return cached data (retry unavailable entries after TTL)
  if (exercise.detailData) {
    if (!exercise.detailData.unavailable) return exercise.detailData;
    const age = Date.now() - (exercise.detailData.timestamp || 0);
    if (age < RETRY_AFTER_MS) return null;
  }

  return fetchAndCacheDetail(exercise);
}

/**
 * Force-retry fetching detail data, ignoring any cached unavailable state.
 */
export async function retryDetailData(exerciseId) {
  const exercise = await get('exercises', exerciseId);
  if (!exercise) return null;
  delete exercise.detailData;
  return fetchAndCacheDetail(exercise);
}

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
    const data = parseGpx(gpxXml);
    data.laps = [];
    data.allTrackpoints = [];
    data.hasHeartRate = false;
    data.hasSpeed = false;
    exercise.detailData = data;
    await put('exercises', exercise);
    return data;
  }

  // Both failed — cache as unavailable with timestamp for TTL retry
  exercise.detailData = { unavailable: true, timestamp: Date.now() };
  await put('exercises', exercise);
  return null;
}

/**
 * Clear all cached unavailable detail data so it gets retried.
 */
export async function clearUnavailableDetails() {
  const exercises = await getAll('exercises');
  for (const ex of exercises) {
    if (ex.detailData?.unavailable) {
      delete ex.detailData;
      await put('exercises', ex);
    }
  }
}

/**
 * Eagerly fetch and cache detail data for a list of exercise IDs.
 * Fire-and-forget; errors are silently ignored.
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
