/**
 * Parse ISO 8601 duration (e.g. "PT1H23M45S") to total seconds.
 */
export function parseISODuration(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || 0, 10);
  const minutes = parseInt(match[2] || 0, 10);
  const seconds = parseFloat(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Format seconds as "H:MM:SS" or "MM:SS".
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
 */
export function formatDistance(meters) {
  if (!meters) return '0.00';
  return (meters / 1000).toFixed(2);
}

/**
 * Calculate pace (min:sec per km) from duration in seconds and distance in meters.
 */
export function formatPace(durationSeconds, distanceMeters) {
  if (!distanceMeters || distanceMeters === 0) return '--:--';
  const paceSeconds = durationSeconds / (distanceMeters / 1000);
  const min = Math.floor(paceSeconds / 60);
  const sec = Math.floor(paceSeconds % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/**
 * Format heart rate.
 */
export function formatHeartRate(hr) {
  if (!hr) return '--';
  return String(Math.round(hr));
}

/**
 * Map detailed sport info to display name.
 */
export function sportLabel(sport) {
  const map = {
    RUNNING: 'Run',
    TRAIL_RUNNING: 'Trail Run',
    TREADMILL_RUNNING: 'Treadmill',
  };
  return map[sport] || sport || 'Run';
}
