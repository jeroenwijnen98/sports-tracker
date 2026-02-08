import { get, put } from '../db.js';
import { getExerciseTcx, getExerciseGpx } from '../api.js';
import { parseTcx } from '../utils/tcxParser.js';
import { parseGpx } from '../utils/gpxParser.js';

/**
 * Get detailed data (trackpoints, laps, route) for an exercise.
 * Checks IndexedDB cache first, then fetches from Polar API.
 * Returns the detail data object, or null if unavailable.
 */
export async function getDetailData(exerciseId) {
  const exercise = await get('exercises', exerciseId);
  if (!exercise) return null;

  // Return cached data
  if (exercise.detailData) {
    return exercise.detailData.unavailable ? null : exercise.detailData;
  }

  // Try TCX
  const tcxXml = await getExerciseTcx(exerciseId);
  if (tcxXml) {
    const data = parseTcx(tcxXml);
    exercise.detailData = data;
    await put('exercises', exercise);
    return data;
  }

  // Fallback: try GPX for map-only data
  const gpxXml = await getExerciseGpx(exerciseId);
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

  // Both failed — cache as unavailable to prevent repeated 404s
  exercise.detailData = { unavailable: true };
  await put('exercises', exercise);
  return null;
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
