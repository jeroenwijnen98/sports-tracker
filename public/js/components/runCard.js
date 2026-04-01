import { formatDistance, formatDuration, formatPace, formatHeartRate, parseISODuration, sportLabel } from '../utils/format.js';
import { formatDate, formatTime } from '../utils/date.js';

/**
 * Create a run card element from an exercise object.
 * @param {object} exercise
 * @param {{ onClick?: (exercise) => void }} options
 */
export function createRunCard(exercise, options = {}) {
  const el = document.createElement('div');
  el.className = 'run-card';

  if (options.onClick) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => options.onClick(exercise));
  }

  const distance = exercise.distance || 0;
  const durationSec = parseISODuration(exercise.duration);
  const avgHr = exercise['heart-rate']?.average;
  const sport = exercise['detailed-sport-info'];
  const startTime = exercise['start-time'];

  el.innerHTML = `
    <div class="run-card-header">
      <span class="run-card-sport">${sportLabel(sport)}</span>
      <span class="run-card-date">${formatDate(startTime)} · ${formatTime(startTime)}${exercise.device ? ` · ${exercise.device}` : ''}</span>
    </div>
    <div class="run-card-distance">
      ${formatDistance(distance)}<span class="run-card-unit">km</span>
    </div>
    <div class="run-card-stats">
      <div class="run-card-stat">
        <span class="run-card-stat-label">Pace</span>
        <span class="run-card-stat-value">${formatPace(durationSec, distance)}</span>
      </div>
      <div class="run-card-stat">
        <span class="run-card-stat-label">Duur</span>
        <span class="run-card-stat-value">${formatDuration(durationSec)}</span>
      </div>
      <div class="run-card-stat">
        <span class="run-card-stat-label">Hartslag</span>
        <span class="run-card-stat-value">${avgHr ? formatHeartRate(avgHr) + ' bpm' : '--'}</span>
      </div>
    </div>
  `;

  return el;
}
