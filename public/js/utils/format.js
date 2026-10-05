// @ts-check

import { RUNNING_SPORT_LABELS, isRunningSportName } from './sports.js';

/**
 * Parse ISO 8601 duration (e.g. "PT1H23M45S") to total seconds.
 *
 * @param {string | undefined} iso
 * @returns {number}
 */
export function parseISODuration(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseFloat(match[3] || '0');
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Format seconds as "H:MM:SS" or "MM:SS".
 *
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Format distance in meters to km with 2 decimals.
 *
 * @param {number | undefined} meters
 * @returns {string}
 */
export function formatDistance(meters) {
  if (!meters) return '0.00';
  return (meters / 1000).toFixed(2);
}

/**
 * The one pace rounding rule: seconds per km rounded to the nearest whole
 * second, carried into the minutes, so the seconds are never 60.
 *
 * @param {number} secondsPerKm
 * @returns {{ min: number, sec: string }} `sec` padded to two digits.
 */
export function paceParts(secondsPerKm) {
  const total = Math.round(secondsPerKm);
  return { min: Math.floor(total / 60), sec: String(total % 60).padStart(2, '0') };
}

/**
 * Calculate pace (min:sec per km) from duration in seconds and distance in
 * meters.
 *
 * @param {number} durationSeconds
 * @param {number | undefined} distanceMeters
 * @returns {string}
 */
export function formatPace(durationSeconds, distanceMeters) {
  if (!distanceMeters || distanceMeters === 0) return '--:--';
  const { min, sec } = paceParts(durationSeconds / (distanceMeters / 1000));
  return `${min}:${sec}`;
}

/**
 * Format heart rate.
 *
 * @param {number | null | undefined} hr
 * @returns {string}
 */
export function formatHeartRate(hr) {
  if (!hr) return '--';
  return String(Math.round(hr));
}

/**
 * Map detailed sport info to display name.
 *
 * @param {string | undefined} sport
 * @returns {string}
 */
export function sportLabel(sport) {
  if (isRunningSportName(sport)) return RUNNING_SPORT_LABELS[sport];
  return sport || 'Run';
}
