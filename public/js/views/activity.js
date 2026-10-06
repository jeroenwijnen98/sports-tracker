// @ts-check

import { getAll } from '../db.js';
import { formatDuration, paceParts, parseISODuration } from '../utils/format.js';
import { periodData } from '../utils/activityPeriods.js';

/** @typedef {import('../utils/activityPeriods.js').Mode} Mode */

/** @type {Mode} */
let currentMode = 'Y';

export async function renderActivity() {
  const container = /** @type {HTMLElement} */ (document.getElementById('tab-activity'));
  const allExercises = await getAll('exercises');
  const exercises = allExercises.filter((ex) => !ex.overlap);

  const { filtered, bars, periodLabel } = periodData(currentMode, exercises, new Date());

  // Totals
  let totalKm = 0;
  let totalSeconds = 0;
  for (const ex of filtered) {
    totalKm += (ex.distance || 0) / 1000;
    totalSeconds += parseISODuration(ex.duration);
  }

  const kmDisplay = totalKm >= 100
    ? Math.round(totalKm).toLocaleString('nl-NL')
    : totalKm.toFixed(1);
  const paceDisplay = formatPaceNRC(totalSeconds, totalKm * 1000);
  const timeDisplay = formatDuration(totalSeconds);

  // Chart calculations
  const maxBarKm = Math.max(...bars.map((b) => b.km), 0);
  const { ticks, niceMax } = computeYAxis(maxBarKm);
  const avgPerBar = bars.length > 0 ? totalKm / bars.length : 0;
  const avgPct = niceMax > 0 ? (avgPerBar / niceMax) * 100 : 0;

  // Grid lines
  const gridHtml = [...ticks, 0]
    .map((t) => {
      const pct = niceMax > 0 ? (t / niceMax) * 100 : 0;
      return `<div class="activity-grid-line" style="bottom: ${pct}%"></div>`;
    })
    .join('');

  // Average line
  const avgHtml =
    avgPerBar > 0
      ? `<div class="activity-avg-line" style="bottom: ${avgPct}%"><span class="activity-avg-value">${fmtBar(avgPerBar)}</span></div>`
      : '';

  // Bars
  const barFillsHtml = bars
    .map((b) => {
      const pct = niceMax > 0 ? (b.km / niceMax) * 100 : 0;
      return `<div class="activity-bar${b.km > 0 ? '' : ' empty'}" style="height: ${pct.toFixed(1)}%"></div>`;
    })
    .join('');

  const barValuesHtml = bars.map((b) => `<span>${b.km > 0 ? fmtBar(b.km) : ''}</span>`).join('');
  const barLabelsHtml = bars.map((b) => `<span>${b.label}</span>`).join('');

  // Y-axis
  const yAxisHtml =
    ticks.map((t, i) => `<span style="top: ${((i / 3) * 100).toFixed(1)}%">${fmtTick(t)}</span>`).join('') +
    '<span style="top: 100%">0km</span>';

  container.innerHTML = `
    <div class="activity-toggle">
      ${['W', 'M', 'Y', 'All']
        .map(
          (m) =>
            `<button class="activity-toggle-btn${m === currentMode ? ' active' : ''}" data-mode="${m}">${m}</button>`
        )
        .join('')}
    </div>
    <div class="activity-period">${periodLabel}</div>
    <div class="activity-hero">
      <span class="activity-hero-value">${kmDisplay}</span>
      <span class="activity-hero-unit">Kilometer</span>
    </div>
    <div class="activity-stats-row">
      <div class="activity-stat-item">
        <span class="activity-stat-val">${filtered.length}</span>
        <span class="activity-stat-lbl">Runs</span>
      </div>
      <div class="activity-stat-item">
        <span class="activity-stat-val">${paceDisplay}</span>
        <span class="activity-stat-lbl">Gem. tempo</span>
      </div>
      <div class="activity-stat-item">
        <span class="activity-stat-val">${timeDisplay}</span>
        <span class="activity-stat-lbl">Tijd</span>
      </div>
    </div>
    <div class="activity-chart-grid">
      <div class="activity-bar-values">${barValuesHtml}</div>
      <div class="activity-chart-area">
        ${gridHtml}
        ${avgHtml}
        ${barFillsHtml}
      </div>
      <div class="activity-y-axis">${yAxisHtml}</div>
      <div class="activity-bar-labels">${barLabelsHtml}</div>
    </div>
  `;

  container.querySelectorAll('.activity-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentMode = /** @type {Mode} */ (/** @type {HTMLElement} */ (btn).dataset.mode);
      renderActivity();
    });
  });
}

/* ── Helpers ── */

/**
 * @param {number} durationSeconds
 * @param {number} distanceMeters
 * @returns {string}
 */
function formatPaceNRC(durationSeconds, distanceMeters) {
  if (!distanceMeters || distanceMeters === 0) return "--'--''";
  const { min, sec } = paceParts(durationSeconds / (distanceMeters / 1000));
  return `${min}'${sec}''`;
}

/**
 * @param {number} maxVal
 * @returns {{ ticks: number[], niceMax: number }}
 */
function computeYAxis(maxVal) {
  if (maxVal <= 0) return { ticks: [3, 2, 1], niceMax: 3 };
  let step;
  if (maxVal <= 3) {
    step = Math.ceil((maxVal / 3) * 2) / 2;
    if (step === 0) step = 0.5;
  } else {
    step = Math.ceil(maxVal / 3);
  }
  const niceMax = step * 3;
  return { ticks: [niceMax, step * 2, step], niceMax };
}

/**
 * @param {number} val
 * @returns {string}
 */
function fmtBar(val) {
  if (val >= 10) return Math.round(val).toString();
  return val.toFixed(1);
}

/**
 * @param {number} val
 * @returns {string}
 */
function fmtTick(val) {
  if (Number.isInteger(val)) return val.toString();
  return val.toFixed(1);
}
