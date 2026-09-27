// @ts-check

/**
 * Format ISO date string to readable date.
 * e.g. "2024-01-15T08:30:00.000" -> "15 jan 2024"
 *
 * @param {string | undefined} isoString
 * @returns {string}
 */
export function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format ISO date string to time.
 * e.g. "2024-01-15T08:30:00.000" -> "08:30"
 *
 * @param {string | undefined} isoString
 * @returns {string}
 */
export function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format to relative day: "Vandaag", "Gisteren", or date string.
 *
 * @param {string | undefined} isoString
 * @returns {string}
 */
export function relativeDay(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Vandaag';
  if (diffDays === 1) return 'Gisteren';
  return formatDate(isoString);
}
