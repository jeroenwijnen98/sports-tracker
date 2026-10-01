// @ts-check

import { get, del } from '../db.js';
import { load } from '../services/detailData.js';
import { recalcShoeKm } from '../sync.js';
import { deleteExercise } from '../api.js';
import { renderActivities } from './activities.js';
import { formatDistance, formatDuration, formatPace, formatHeartRate, parseISODuration, sportLabel } from '../utils/format.js';
import { formatDate, formatTime } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';
import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';

/** @typedef {import('../../../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../../../types/domain.ts').DetailData} DetailData */
/** @typedef {import('../../../types/domain.ts').Trackpoint} Trackpoint */

/**
 * Leaflet, as the CDN script puts it on `window.L`. Only its types come from
 * `@types/leaflet`; the library itself is never bundled.
 * @typedef {typeof import('leaflet')} Leaflet
 */

const container = /** @type {HTMLElement} */ (document.getElementById('run-detail-container'));
/** @type {import('leaflet').Map | null} */
let leafletMap = null;

/** @param {string} exerciseId */
export async function openRunDetail(exerciseId) {
  const exercise = await get('exercises', exerciseId);
  if (!exercise) return;

  const distance = exercise.distance || 0;
  const durationSec = parseISODuration(exercise.duration);
  const avgHr = exercise['heart-rate']?.average;
  const maxHr = exercise['heart-rate']?.maximum;
  const sport = exercise['detailed-sport-info'];
  const startTime = exercise['start-time'];

  container.innerHTML = `
    <div class="run-detail">
      <div class="run-detail-topbar">
        <button class="run-detail-back" id="run-detail-back">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div class="run-detail-topbar-info">
          <span class="run-detail-sport">${sportLabel(sport)}</span>
          <span class="run-detail-date">${formatDate(startTime)} · ${formatTime(startTime)}${exercise.device ? ` · ${escapeHtml(exercise.device)}` : ''}</span>
        </div>
      </div>

      <div class="run-detail-body">
        <div class="run-detail-hero">
          <div class="run-detail-hero-distance">
            ${formatDistance(distance)}<span class="run-detail-hero-unit">km</span>
          </div>
        </div>

        <div class="run-detail-stats-row">
          <div class="run-detail-stat">
            <span class="run-detail-stat-value">${formatDuration(durationSec)}</span>
            <span class="run-detail-stat-label">Duur</span>
          </div>
          <div class="run-detail-stat">
            <span class="run-detail-stat-value">${formatPace(durationSec, distance)}</span>
            <span class="run-detail-stat-label">Gem. tempo</span>
          </div>
          <div class="run-detail-stat">
            <span class="run-detail-stat-value">${avgHr ? formatHeartRate(avgHr) : '--'}</span>
            <span class="run-detail-stat-label">Gem. HS</span>
          </div>
          <div class="run-detail-stat">
            <span class="run-detail-stat-value">${maxHr ? formatHeartRate(maxHr) : '--'}</span>
            <span class="run-detail-stat-label">Max HS</span>
          </div>
        </div>

        <div id="run-detail-chart-section" class="run-detail-section" style="display:none">
          ${chartMarkup()}
        </div>

        <div id="run-detail-laps-section" class="run-detail-section" style="display:none">
          <h3 class="run-detail-section-title">Ronden</h3>
          <div id="run-detail-laps" class="run-detail-laps"></div>
        </div>

        <div id="run-detail-map-section" class="run-detail-section" style="display:none">
          <h3 class="run-detail-section-title">Route</h3>
          <div id="run-detail-map" class="run-detail-map"></div>
        </div>

        <div class="run-detail-section">
          <button class="btn btn-danger btn-sm run-detail-delete" id="run-detail-delete">Activiteit verwijderen</button>
        </div>
      </div>

      <div id="run-detail-loading" class="run-detail-loading">
        <div class="spinner"></div>
        <p>Details laden...</p>
      </div>
    </div>
  `;

  container.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Back button
  document.getElementById('run-detail-back')?.addEventListener('click', closeRunDetail);

  // Delete button
  document.getElementById('run-detail-delete')?.addEventListener('click', () => {
    confirmDelete(exercise);
  });

  // Load detail data
  const detail = await load(exerciseId);
  const loadingEl = document.getElementById('run-detail-loading');
  if (loadingEl) loadingEl.style.display = 'none';

  if (detail) {
    renderChart(detail);
    renderLaps(detail);
    renderMap(detail);
  } else {
    showRetryButton(exerciseId);
  }
}

/** @param {string} exerciseId */
function showRetryButton(exerciseId) {
  const chartSection = document.getElementById('run-detail-chart-section');
  if (!chartSection) return;

  chartSection.style.display = '';
  chartSection.innerHTML = `
    <div class="run-detail-retry">
      <p>Details konden niet worden geladen.</p>
      <button class="btn btn-secondary btn-sm" id="run-detail-retry-btn">Opnieuw proberen</button>
    </div>
  `;

  const retryBtn = /** @type {HTMLButtonElement} */ (document.getElementById('run-detail-retry-btn'));
  retryBtn.addEventListener('click', async () => {
    retryBtn.textContent = 'Laden...';
    retryBtn.disabled = true;

    const detail = await load(exerciseId, { force: true });
    if (detail) {
      chartSection.innerHTML = chartMarkup();
      renderChart(detail);
      renderLaps(detail);
      renderMap(detail);
      showToast('Details geladen', 'success');
    } else {
      retryBtn.textContent = 'Opnieuw proberen';
      retryBtn.disabled = false;
      showToast('Details niet beschikbaar', 'error');
    }
  });
}

export function closeRunDetail() {
  destroyMap();
  container.classList.remove('active');
  container.innerHTML = '';
  document.body.style.overflow = '';
}

/* ── Chart ── */

const PACE_COLOR = '#CEFF00';
const HR_COLOR = '#FF4D6D';

/** @typedef {'pace' | 'hr' | 'both'} ChartMode */

/**
 * A trackpoint reduced to what the chart needs: seconds since the start and,
 * where known, speed in m/s.
 * @typedef {{ d: number, t: number, hr: number | null, speed: number | null }} ChartPoint
 */

/**
 * One plotted sample: cumulative metres, heart rate and pace in min/km.
 * @typedef {{ d: number, hr: number | null, pace: number | null }} ChartSample
 */

/**
 * @typedef {object} ChartSeries
 * @property {ChartSample[]} samples
 * @property {number} maxD Metres at the last sample.
 * @property {boolean} hasPace
 * @property {boolean} hasHr
 * @property {number} paceMin
 * @property {number} paceMax
 * @property {number} hrMin
 * @property {number} hrMax
 */

/** @typedef {{ top: number, right: number, bottom: number, left: number }} Padding */

/** @typedef {(value: number) => number} Scale */

/** @type {ChartMode} */
let chartMode = 'pace';
/** @type {ChartSeries | null} */
let chartSeries = null;

function chartMarkup() {
  return `
    <div class="run-detail-chart-head">
      <div class="run-detail-chart-toggle" id="chart-toggle">
        <button class="run-detail-chart-toggle-btn active" data-mode="pace">Tempo</button>
        <button class="run-detail-chart-toggle-btn" data-mode="hr">Hartslag</button>
        <button class="run-detail-chart-toggle-btn" data-mode="both">Beide</button>
      </div>
      <div class="run-detail-chart-legend" id="chart-legend" style="display:none">
        <span><i style="background:${PACE_COLOR}"></i>Tempo</span>
        <span><i style="background:${HR_COLOR}"></i>Hartslag</span>
      </div>
      <div class="run-detail-chart-readout" id="chart-readout"></div>
    </div>
    <div class="run-detail-chart-wrap">
      <canvas id="run-detail-chart"></canvas>
      <canvas id="run-detail-chart-cursor" class="run-detail-chart-cursor"></canvas>
    </div>
  `;
}

/** @param {DetailData} detail */
function renderChart(detail) {
  chartSeries = buildChartSeries(detail);
  if (!chartSeries) return;

  const { hasPace, hasHr } = chartSeries;
  /** @type {ChartMode[]} */
  const modes = [];
  if (hasPace) modes.push('pace');
  if (hasHr) modes.push('hr');
  if (hasPace && hasHr) modes.push('both');
  chartMode = modes[0];

  const section = /** @type {HTMLElement} */ (document.getElementById('run-detail-chart-section'));
  section.style.display = '';

  const toggle = /** @type {HTMLElement} */ (document.getElementById('chart-toggle'));
  toggle.style.display = modes.length > 1 ? '' : 'none';
  /** @type {NodeListOf<HTMLElement>} */
  const buttons = toggle.querySelectorAll('.run-detail-chart-toggle-btn');
  buttons.forEach((btn) => {
    const mode = /** @type {ChartMode} */ (btn.dataset.mode);
    const available = modes.includes(mode);
    btn.style.display = available ? '' : 'none';
    btn.classList.toggle('active', btn.dataset.mode === chartMode);
    if (!available) return;
    btn.addEventListener('click', () => {
      chartMode = mode;
      buttons.forEach((b) =>
        b.classList.toggle('active', b.dataset.mode === chartMode)
      );
      drawChart();
      clearChartCursor();
    });
  });

  drawChart();
  attachChartScrub();
}

/**
 * Flatten trackpoints into { d, pace, hr } samples.
 * Polar doesn't always record <Speed>, so pace falls back to distance/time deltas.
 *
 * @param {DetailData} detail
 * @returns {ChartSeries | null}
 */
function buildChartSeries(detail) {
  /** @type {ChartPoint[]} */
  let points = (detail.allTrackpoints || [])
    .filter(
      /** @returns {tp is Trackpoint & { distance: number, time: string }} */
      (tp) => tp.distance !== null && !!tp.time
    )
    .map((tp, i, arr) => ({
      d: tp.distance,
      t: (Date.parse(tp.time) - Date.parse(arr[0].time)) / 1000,
      hr: tp.heartRate,
      speed: tp.speed !== null && tp.speed > 0 ? tp.speed : null,
    }));

  if (points.length < 2) return null;

  const window = 4;
  for (let i = 0; i < points.length; i++) {
    if (points[i].speed !== null) continue;
    const a = points[Math.max(0, i - window)];
    const b = points[Math.min(points.length - 1, i + window)];
    points[i].speed = b.t > a.t ? (b.d - a.d) / (b.t - a.t) : null;
  }

  // Downsample to ~400 samples, then roll a moving average over both metrics.
  if (points.length > 400) {
    const step = points.length / 400;
    points = Array.from({ length: 400 }, (_, i) => points[Math.floor(i * step)]);
  }
  points = rollingAverage(points, 'speed', 6);
  points = rollingAverage(points, 'hr', 4);

  const samples = points.map((p) => ({
    d: p.d,
    hr: p.hr,
    // min/km; standing still (< 1 m/s) leaves a gap instead of a spike
    pace: p.speed !== null && p.speed > 1 ? Math.min(1000 / 60 / p.speed, 15) : null,
  }));

  const paces = samples.map((p) => p.pace).filter((v) => v !== null);
  const hrs = samples.map((p) => p.hr).filter(/** @returns {v is number} */ (v) => !!v);

  return {
    samples,
    maxD: samples[samples.length - 1].d || 1,
    hasPace: paces.length > 0,
    hasHr: hrs.length > 0,
    paceMin: Math.min(...paces),
    paceMax: Math.max(...paces),
    hrMin: Math.min(...hrs),
    hrMax: Math.max(...hrs),
  };
}

/**
 * @param {ChartPoint[]} points
 * @param {'speed' | 'hr'} key
 * @param {number} window Samples on either side.
 * @returns {ChartPoint[]}
 */
function rollingAverage(points, key, window) {
  return points.map((p, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(points.length - 1, i + window); j++) {
      const value = points[j][key];
      if (value != null) {
        sum += value;
        count++;
      }
    }
    return { ...p, [key]: count ? sum / count : null };
  });
}

/**
 * @typedef {object} ChartGeometry
 * @property {Scale} xScale
 * @property {Scale} paceScale
 * @property {Scale} hrScale
 * @property {Padding} pad
 * @property {number} plotH
 * @property {boolean} showPace
 * @property {boolean} showHr
 */

/**
 * Current chart geometry, kept around so the scrub cursor can reuse it.
 * @type {ChartGeometry | null}
 */
let chartGeometry = null;

function drawChart() {
  const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('run-detail-chart'));
  const series = chartSeries;
  if (!canvas || !series) return;

  const legend = document.getElementById('chart-legend');
  if (legend) legend.style.display = chartMode === 'both' ? '' : 'none';

  const { ctx, w, h } = chartContext(canvas);
  const showPace = chartMode === 'pace' || chartMode === 'both';
  const showHr = chartMode === 'hr' || chartMode === 'both';
  /** @type {Padding} */
  const pad = { top: 16, right: chartMode === 'both' ? 42 : 12, bottom: 22, left: 42 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const [paceLo, paceHi] = axisBounds(series.paceMin, series.paceMax);
  const [hrLo, hrHi] = axisBounds(series.hrMin, series.hrMax);

  /** @type {Scale} */
  const xScale = (d) => pad.left + (d / series.maxD) * plotW;
  // Pace is inverted: a lower min/km is faster, so it sits higher on the chart.
  /** @type {Scale} */
  const paceScale = (v) => pad.top + ((v - paceLo) / (paceHi - paceLo)) * plotH;
  /** @type {Scale} */
  const hrScale = (v) => pad.top + plotH - ((v - hrLo) / (hrHi - hrLo)) * plotH;

  drawGrid(ctx, w, pad, plotH);

  if (showPace) {
    drawAxisLabels(ctx, pad, plotH, 'left', (i) => formatPaceValue(paceLo + ((paceHi - paceLo) / 4) * i), PACE_COLOR);
  } else {
    drawAxisLabels(ctx, pad, plotH, 'left', (i) => Math.round(hrHi - ((hrHi - hrLo) / 4) * i), '#666666');
  }
  if (chartMode === 'both') {
    drawAxisLabels(ctx, pad, plotH, 'right', (i) => Math.round(hrHi - ((hrHi - hrLo) / 4) * i), HR_COLOR, plotW);
  }

  drawDistanceLabels(ctx, h, pad, xScale, series.maxD);

  const solo = chartMode !== 'both';
  if (showHr) {
    drawMetric(ctx, series.samples, xScale, hrScale, 'hr', HR_COLOR, solo ? 2 : 1.75, solo ? pad.top + plotH : null, pad.top);
  }
  if (showPace) {
    drawMetric(ctx, series.samples, xScale, paceScale, 'pace', PACE_COLOR, solo ? 2 : 2.25, solo ? pad.top + plotH : null, pad.top);
  }

  chartGeometry = { xScale, paceScale, hrScale, pad, plotH, showPace, showHr };
}

/**
 * Size a canvas to its box at the device pixel ratio and clear it.
 * @param {HTMLCanvasElement} canvas
 */
function chartContext(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, rect.width * dpr);
  canvas.height = Math.max(1, rect.height * dpr);
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, w: rect.width, h: rect.height };
}

/**
 * @param {number} min
 * @param {number} max
 * @returns {[number, number]}
 */
function axisBounds(min, max) {
  const range = max - min || 1;
  return [min - range * 0.08, max + range * 0.08];
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {Padding} pad
 * @param {number} plotH
 */
function drawGrid(ctx, w, pad, plotH) {
  ctx.strokeStyle = '#242424';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Padding} pad
 * @param {number} plotH
 * @param {'left' | 'right'} side
 * @param {(i: number) => string | number} valueAt
 * @param {string} color
 * @param {number} [plotW]
 */
function drawAxisLabels(ctx, pad, plotH, side, valueAt, color, plotW = 0) {
  ctx.fillStyle = color;
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = side === 'left' ? 'right' : 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.fillText(String(valueAt(i)), side === 'left' ? pad.left - 6 : pad.left + plotW + 6, y);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} h
 * @param {Padding} pad
 * @param {Scale} xScale
 * @param {number} maxD Metres at the last sample.
 */
function drawDistanceLabels(ctx, h, pad, xScale, maxD) {
  ctx.fillStyle = '#666666';
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const kmMax = maxD / 1000;
  const step = kmMax <= 3 ? 0.5 : kmMax <= 8 ? 1 : kmMax <= 20 ? 2 : 5;
  for (let km = 0; km <= kmMax + 1e-6; km += step) {
    ctx.fillText(kmMax <= 3 ? km.toFixed(1) : String(km), xScale(km * 1000), h - pad.bottom + 5);
  }
}

/**
 * Draw one metric as a line, splitting on gaps; `areaBase` adds a gradient fill.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ChartSample[]} samples
 * @param {Scale} xScale
 * @param {Scale} yScale
 * @param {'hr' | 'pace'} key
 * @param {string} color
 * @param {number} lineWidth
 * @param {number | null} areaBase
 * @param {number} top
 */
function drawMetric(ctx, samples, xScale, yScale, key, color, lineWidth, areaBase, top) {
  /** @type {ChartSample[][]} */
  const segments = [];
  /** @type {ChartSample[]} */
  let current = [];
  for (const sample of samples) {
    if (sample[key] == null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(sample);
    }
  }
  if (current.length) segments.push(current);

  if (areaBase !== null) {
    const gradient = ctx.createLinearGradient(0, top, 0, areaBase);
    gradient.addColorStop(0, withAlpha(color, 0.28));
    gradient.addColorStop(1, withAlpha(color, 0.02));
    ctx.fillStyle = gradient;
    for (const segment of segments) {
      ctx.beginPath();
      ctx.moveTo(xScale(segment[0].d), areaBase);
      for (const sample of segment) ctx.lineTo(xScale(sample.d), yScale(/** @type {number} */ (sample[key])));
      ctx.lineTo(xScale(segment[segment.length - 1].d), areaBase);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  for (const segment of segments) {
    ctx.beginPath();
    segment.forEach((sample, i) => {
      const x = xScale(sample.d);
      const y = yScale(/** @type {number} */ (sample[key]));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

/**
 * @param {string} hex `#RRGGBB`
 * @param {number} alpha
 * @returns {string}
 */
function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * @param {number} minPerKm
 * @returns {string}
 */
function formatPaceValue(minPerKm) {
  const min = Math.floor(minPerKm);
  const sec = Math.round((minPerKm - min) * 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/* ── Chart scrub ── */

function attachChartScrub() {
  const canvas = document.getElementById('run-detail-chart');
  const wrap = canvas?.parentElement;
  if (!canvas || !wrap) return;

  /** @param {MouseEvent | TouchEvent} e */
  const move = (e) => {
    const touch = 'touches' in e ? e.touches[0] : undefined;
    const rect = canvas.getBoundingClientRect();
    const { clientX } = touch || /** @type {MouseEvent} */ (e);
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    drawChartCursor(frac);
    if (touch) e.preventDefault();
  };

  wrap.addEventListener('mousemove', move);
  wrap.addEventListener('mouseleave', clearChartCursor);
  wrap.addEventListener('touchstart', move, { passive: false });
  wrap.addEventListener('touchmove', move, { passive: false });
  wrap.addEventListener('touchend', clearChartCursor);
}

/** @param {number} frac Position across the chart, 0 to 1. */
function drawChartCursor(frac) {
  const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('run-detail-chart-cursor'));
  if (!canvas || !chartGeometry || !chartSeries) return;

  const target = frac * chartSeries.maxD;
  let sample = chartSeries.samples[0];
  for (const candidate of chartSeries.samples) {
    if (Math.abs(candidate.d - target) < Math.abs(sample.d - target)) sample = candidate;
  }

  const { ctx } = chartContext(canvas);
  const { xScale, paceScale, hrScale, pad, plotH, showPace, showHr } = chartGeometry;
  const x = xScale(sample.d);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, pad.top);
  ctx.lineTo(x, pad.top + plotH);
  ctx.stroke();

  /** @type {[y: number, color: string][]} */
  const dots = [];
  if (showPace && sample.pace !== null) dots.push([paceScale(sample.pace), PACE_COLOR]);
  if (showHr && sample.hr) dots.push([hrScale(sample.hr), HR_COLOR]);
  for (const [y, color] of dots) {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  const parts = [`${(sample.d / 1000).toFixed(2)} km`];
  if (showPace) parts.push(sample.pace !== null ? `${formatPaceValue(sample.pace)} /km` : '--:-- /km');
  if (showHr) parts.push(sample.hr ? `${Math.round(sample.hr)} bpm` : '-- bpm');
  const readout = document.getElementById('chart-readout');
  if (readout) readout.textContent = parts.join(' · ');
}

function clearChartCursor() {
  const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('run-detail-chart-cursor'));
  if (canvas) chartContext(canvas);
  const readout = document.getElementById('chart-readout');
  if (readout) readout.textContent = '';
}

/* ── Laps ── */

/** @param {DetailData} detail */
function renderLaps(detail) {
  if (!detail.laps || detail.laps.length <= 1) return;

  const section = /** @type {HTMLElement} */ (document.getElementById('run-detail-laps-section'));
  section.style.display = '';

  const lapsEl = /** @type {HTMLElement} */ (document.getElementById('run-detail-laps'));
  const laps = detail.laps;

  // Find max distance for bar widths
  const maxDist = Math.max(...laps.map((l) => l.distance || 0));

  let html = `
    <table class="laps-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Afstand</th>
          <th>Tijd</th>
          <th>Gem. tempo</th>
          <th>Gem. HS</th>
          <th>Max HS</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const lap of laps) {
    const dist = lap.distance || 0;
    const dur = lap.duration || 0;
    const pace = formatPace(dur, dist);
    const avgHr = lap.avgHR ? Math.round(lap.avgHR) : '--';
    const maxHr = lap.maxHR ? Math.round(lap.maxHR) : '--';
    const distPct = maxDist > 0 ? (dist / maxDist) * 100 : 0;
    const delay = (lap.index - 1) * 60;

    html += `
      <tr class="laps-row" style="animation-delay: ${delay}ms">
        <td>${lap.index}</td>
        <td>
          <div class="lap-bar-wrap">
            <div class="lap-bar" style="width: ${distPct}%"></div>
            <span>${(dist / 1000).toFixed(2)} km</span>
          </div>
        </td>
        <td>${formatDuration(dur)}</td>
        <td>${pace}</td>
        <td>${avgHr}</td>
        <td>${maxHr}</td>
      </tr>
    `;
  }

  html += '</tbody></table>';
  lapsEl.innerHTML = html;
}

/* ── Map ── */

/** @param {DetailData} detail */
async function renderMap(detail) {
  if (!detail.hasGps || detail.route.length === 0) return;

  const section = /** @type {HTMLElement} */ (document.getElementById('run-detail-map-section'));
  section.style.display = '';

  // Dynamically load Leaflet
  const L = await loadLeaflet();

  const mapEl = /** @type {HTMLElement} */ (document.getElementById('run-detail-map'));
  const map = L.map(mapEl, {
    zoomControl: false,
    attributionControl: false,
  });
  leafletMap = map;

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
  }).addTo(map);

  const route = detail.route;
  const polyline = L.polyline(route, {
    color: '#CEFF00',
    weight: 3,
    opacity: 0.9,
  }).addTo(map);

  // Start marker
  L.circleMarker(route[0], {
    radius: 6,
    fillColor: '#00CC66',
    fillOpacity: 1,
    color: '#0D0D0D',
    weight: 2,
  }).addTo(map);

  // End marker
  L.circleMarker(route[route.length - 1], {
    radius: 6,
    fillColor: '#FF4444',
    fillOpacity: 1,
    color: '#0D0D0D',
    weight: 2,
  }).addTo(map);

  map.fitBounds(polyline.getBounds(), { padding: [20, 20] });
}

/**
 * Load Leaflet from the CDN the first time a route is shown.
 * @returns {Promise<Leaflet>}
 */
function loadLeaflet() {
  const win = /** @type {Window & { L?: Leaflet }} */ (window);
  if (win.L) return Promise.resolve(win.L);

  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve(/** @type {Leaflet} */ (win.L));
    document.head.appendChild(script);
  });
}

function destroyMap() {
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }
}

/* ── Delete ── */

/** @param {Exercise} exercise */
function confirmDelete(exercise) {
  const dist = formatDistance(exercise.distance || 0);
  const date = formatDate(exercise['start-time']);

  openModal(`
    <div class="modal-header">
      <h2>Activiteit verwijderen</h2>
      <button class="btn-icon btn-ghost" id="modal-close-btn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="modal-body">
      <p>Weet je zeker dat je deze activiteit wilt verwijderen?</p>
      <p style="color: var(--text-secondary); font-size: 0.875rem;">${date} · ${dist} km</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary btn-sm" id="modal-cancel">Annuleren</button>
      <button class="btn btn-danger btn-sm" id="modal-confirm-delete">Verwijderen</button>
    </div>
  `);

  document.getElementById('modal-close-btn')?.addEventListener('click', closeModal);
  document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-confirm-delete')?.addEventListener('click', async () => {
    closeModal();
    try {
      await deleteExercise(exercise.id);
    } catch (err) {
      console.error('Delete failed:', err);
      showToast('Verwijderen mislukt, probeer het later opnieuw', 'error');
      return;
    }
    const shoeId = exercise.shoeId;
    await del('exercises', exercise.id);
    if (shoeId) await recalcShoeKm(shoeId);
    closeRunDetail();
    await renderActivities();
    showToast('Activiteit verwijderd', 'success');
  });
}
