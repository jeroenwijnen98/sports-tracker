// @ts-check

import { getAll } from '../db.js';
import { formatDuration, paceParts, parseISODuration } from '../utils/format.js';

/** @typedef {import('../../../types/domain.ts').Exercise} Exercise */

/** @typedef {'W' | 'M' | 'Y' | 'All'} Mode */

/**
 * One bar of the chart: the kilometres run in one day, week, month or year.
 * @typedef {{ km: number, label: string, key?: string, year?: number }} Bar
 */

/** @typedef {{ filtered: Exercise[], bars: Bar[], periodLabel: string }} PeriodData */

const MONTH_LABELS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MONTH_NAMES = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const DAY_LABELS = ['M', 'D', 'W', 'D', 'V', 'Z', 'Z'];

/** @type {Mode} */
let currentMode = 'Y';

export async function renderActivity() {
  const container = /** @type {HTMLElement} */ (document.getElementById('tab-activity'));
  const allExercises = await getAll('exercises');
  const exercises = allExercises.filter((ex) => !ex.overlap);

  const { filtered, bars, periodLabel } = getData(currentMode, exercises);

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

/* ── Data builders ── */

/**
 * @param {Mode} mode
 * @param {Exercise[]} exercises
 * @returns {PeriodData}
 */
function getData(mode, exercises) {
  const now = new Date();
  switch (mode) {
    case 'W':
      return buildWeekData(exercises, now);
    case 'M':
      return buildMonthData(exercises, now);
    case 'Y':
      return buildYearData(exercises, now);
    default:
      return buildAllData(exercises, now);
  }
}

/**
 * @param {Exercise[]} exercises
 * @param {Date} now
 * @returns {PeriodData}
 */
function buildWeekData(exercises, now) {
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const filtered = exercises.filter((ex) => {
    const d = new Date(ex['start-time']);
    return d >= monday && d <= sunday;
  });

  const bars = DAY_LABELS.map((label) => ({ km: 0, label }));

  for (const ex of filtered) {
    const d = new Date(ex['start-time']);
    let dow = d.getDay() - 1;
    if (dow < 0) dow = 6;
    bars[dow].km += (ex.distance || 0) / 1000;
  }

  return { filtered, bars, periodLabel: 'Deze week' };
}

/**
 * @param {Exercise[]} exercises
 * @param {Date} now
 * @returns {PeriodData}
 */
function buildMonthData(exercises, now) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const daysInMonth = lastDay.getDate();

  const filtered = exercises.filter((ex) => {
    const d = new Date(ex['start-time']);
    return d >= firstDay && d <= lastDay;
  });

  /** @type {number[]} */
  const starts = [];
  for (let d = 1; d <= daysInMonth; d += 7) starts.push(d);

  /** @type {Bar[]} */
  const bars = starts.map((start) => ({ km: 0, label: String(start) }));

  for (const ex of filtered) {
    const d = new Date(ex['start-time']).getDate();
    for (let i = bars.length - 1; i >= 0; i--) {
      if (d >= starts[i]) {
        bars[i].km += (ex.distance || 0) / 1000;
        break;
      }
    }
  }

  const name = MONTH_NAMES[month];
  return { filtered, bars, periodLabel: `${name.charAt(0).toUpperCase() + name.slice(1)} ${year}` };
}

/**
 * @param {Exercise[]} exercises
 * @param {Date} now
 * @returns {PeriodData}
 */
function buildYearData(exercises, now) {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const startDate = new Date(currentYear, currentMonth - 11, 1);
  const endDate = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);

  const filtered = exercises.filter((ex) => {
    const d = new Date(ex['start-time']);
    return d >= startDate && d <= endDate;
  });

  /** @type {Bar[]} */
  const bars = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(currentYear, currentMonth - 11 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    bars.push({ km: 0, label: MONTH_LABELS[d.getMonth()], key });
  }

  for (const ex of filtered) {
    const d = new Date(ex['start-time']);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const bar = bars.find((b) => b.key === key);
    if (bar) bar.km += (ex.distance || 0) / 1000;
  }

  const startMonth = new Date(currentYear, currentMonth - 11, 1);
  const periodLabel = `${MONTH_LABELS[startMonth.getMonth()]} ${startMonth.getFullYear()} – ${MONTH_LABELS[currentMonth]} ${currentYear}`;

  return { filtered, bars, periodLabel };
}

/**
 * @param {Exercise[]} exercises
 * @param {Date} now
 * @returns {PeriodData}
 */
function buildAllData(exercises, now) {
  if (exercises.length === 0) {
    const y = now.getFullYear();
    return { filtered: [], bars: [{ km: 0, label: String(y) }], periodLabel: String(y) };
  }

  let minYear = Infinity;
  let maxYear = -Infinity;
  for (const ex of exercises) {
    const y = new Date(ex['start-time']).getFullYear();
    if (y < minYear) minYear = y;
    if (y > maxYear) maxYear = y;
  }
  maxYear = Math.max(maxYear, now.getFullYear());

  /** @type {Bar[]} */
  const bars = [];
  for (let y = minYear; y <= maxYear; y++) {
    bars.push({ km: 0, label: String(y), year: y });
  }

  for (const ex of exercises) {
    const y = new Date(ex['start-time']).getFullYear();
    const bar = bars.find((b) => b.year === y);
    if (bar) bar.km += (ex.distance || 0) / 1000;
  }

  const periodLabel = minYear === maxYear ? String(minYear) : `${minYear}\u2013${maxYear}`;

  return { filtered: [...exercises], bars, periodLabel };
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
