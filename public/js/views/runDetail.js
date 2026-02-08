import { get, del } from '../db.js';
import { getDetailData } from '../services/detailData.js';
import { recalcShoeKm } from '../sync.js';
import { renderActivities } from './activities.js';
import { formatDistance, formatDuration, formatPace, formatHeartRate, parseISODuration, sportLabel } from '../utils/format.js';
import { formatDate, formatTime } from '../utils/date.js';
import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';

const container = document.getElementById('run-detail-container');
let leafletMap = null;

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
          <span class="run-detail-date">${formatDate(startTime)} · ${formatTime(startTime)}</span>
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
          <div class="run-detail-chart-toggle" id="chart-toggle">
            <button class="run-detail-chart-toggle-btn active" data-mode="pace">Tempo</button>
            <button class="run-detail-chart-toggle-btn" data-mode="hr">Hartslag</button>
          </div>
          <div class="run-detail-chart-wrap">
            <canvas id="run-detail-chart"></canvas>
          </div>
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
  document.getElementById('run-detail-back').addEventListener('click', closeRunDetail);

  // Delete button
  document.getElementById('run-detail-delete').addEventListener('click', () => {
    confirmDelete(exercise);
  });

  // Load detail data
  const detail = await getDetailData(exerciseId);
  const loadingEl = document.getElementById('run-detail-loading');
  if (loadingEl) loadingEl.style.display = 'none';

  if (detail) {
    renderChart(detail);
    renderLaps(detail);
    renderMap(detail);
  }
}

export function closeRunDetail() {
  destroyMap();
  container.classList.remove('active');
  container.innerHTML = '';
  document.body.style.overflow = '';
}

/* ── Chart ── */

let currentChartMode = 'pace';
let chartDetail = null;

function renderChart(detail) {
  chartDetail = detail;

  const hasData = (detail.hasSpeed || detail.hasHeartRate) && detail.allTrackpoints.length > 0;
  if (!hasData) return;

  // If no speed, default to HR
  if (!detail.hasSpeed && detail.hasHeartRate) currentChartMode = 'hr';
  else currentChartMode = 'pace';

  const section = document.getElementById('run-detail-chart-section');
  section.style.display = '';

  // Hide toggle buttons if only one mode
  const toggle = document.getElementById('chart-toggle');
  if (!detail.hasSpeed || !detail.hasHeartRate) {
    toggle.style.display = 'none';
  } else {
    toggle.querySelectorAll('.run-detail-chart-toggle-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === currentChartMode);
      btn.addEventListener('click', () => {
        currentChartMode = btn.dataset.mode;
        toggle.querySelectorAll('.run-detail-chart-toggle-btn').forEach((b) =>
          b.classList.toggle('active', b.dataset.mode === currentChartMode)
        );
        drawChart();
      });
    });
  }

  drawChart();
}

function drawChart() {
  const canvas = document.getElementById('run-detail-chart');
  if (!canvas || !chartDetail) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = { top: 20, right: 10, bottom: 24, left: 40 };

  ctx.clearRect(0, 0, w, h);

  // Get data points
  let points = chartDetail.allTrackpoints
    .filter((tp) => tp.distance !== null)
    .map((tp) => ({
      distance: tp.distance,
      value: currentChartMode === 'pace' ? tp.speed : tp.heartRate,
    }))
    .filter((p) => p.value !== null && p.value > 0);

  if (points.length === 0) return;

  // Downsample to ~500 points
  if (points.length > 500) {
    const step = points.length / 500;
    const sampled = [];
    for (let i = 0; i < 500; i++) {
      sampled.push(points[Math.floor(i * step)]);
    }
    points = sampled;
  }

  // Rolling average smoothing (~10 points window)
  const windowSize = Math.min(10, Math.floor(points.length / 5));
  if (windowSize > 1) {
    const smoothed = [];
    for (let i = 0; i < points.length; i++) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - windowSize); j <= Math.min(points.length - 1, i + windowSize); j++) {
        sum += points[j].value;
        count++;
      }
      smoothed.push({ ...points[i], value: sum / count });
    }
    points = smoothed;
  }

  // For pace mode, convert speed (m/s) to pace (min/km) - inverted
  let values;
  if (currentChartMode === 'pace') {
    values = points.map((p) => {
      const paceMinKm = 1000 / 60 / p.value; // min/km
      return paceMinKm;
    });
  } else {
    values = points.map((p) => p.value);
  }

  const maxDist = points[points.length - 1].distance;
  let minVal = Math.min(...values);
  let maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  minVal -= range * 0.05;
  maxVal += range * 0.05;

  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const xScale = (d) => pad.left + (d / maxDist) * plotW;
  // For pace, invert: lower pace = faster = higher on chart
  const yScale = (v) => {
    if (currentChartMode === 'pace') {
      return pad.top + ((v - minVal) / (maxVal - minVal)) * plotH;
    }
    return pad.top + plotH - ((v - minVal) / (maxVal - minVal)) * plotH;
  };

  // Grid lines
  ctx.strokeStyle = '#2A2A2A';
  ctx.lineWidth = 1;
  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const y = pad.top + (plotH / gridCount) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }

  // Y-axis labels
  ctx.fillStyle = '#666666';
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= gridCount; i++) {
    const y = pad.top + (plotH / gridCount) * i;
    let val;
    if (currentChartMode === 'pace') {
      val = minVal + ((maxVal - minVal) / gridCount) * i;
      const min = Math.floor(val);
      const sec = Math.round((val - min) * 60);
      ctx.fillText(`${min}:${String(sec).padStart(2, '0')}`, pad.left - 6, y);
    } else {
      val = maxVal - ((maxVal - minVal) / gridCount) * i;
      ctx.fillText(Math.round(val), pad.left - 6, y);
    }
  }

  // X-axis labels (distance in km)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const kmMax = maxDist / 1000;
  const kmStep = niceStep(kmMax, 5);
  for (let km = 0; km <= kmMax; km += kmStep) {
    const x = xScale(km * 1000);
    ctx.fillText(`${Math.round(km)}`, x, h - pad.bottom + 6);
  }

  // Area fill
  const gradient = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
  gradient.addColorStop(0, 'rgba(206, 255, 0, 0.25)');
  gradient.addColorStop(1, 'rgba(206, 255, 0, 0.02)');

  ctx.beginPath();
  ctx.moveTo(xScale(points[0].distance), currentChartMode === 'pace' ? pad.top + plotH : h - pad.bottom);
  for (const p of points) {
    ctx.lineTo(xScale(p.distance), yScale(currentChartMode === 'pace' ? 1000 / 60 / p.value : p.value));
  }
  ctx.lineTo(xScale(points[points.length - 1].distance), currentChartMode === 'pace' ? pad.top + plotH : h - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Line
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const x = xScale(points[i].distance);
    const y = yScale(values[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#CEFF00';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function niceStep(max, targetTicks) {
  const rough = max / targetTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / pow;
  let step;
  if (normalized <= 1) step = 1;
  else if (normalized <= 2) step = 2;
  else if (normalized <= 5) step = 5;
  else step = 10;
  return step * pow;
}

/* ── Laps ── */

function renderLaps(detail) {
  if (!detail.laps || detail.laps.length <= 1) return;

  const section = document.getElementById('run-detail-laps-section');
  section.style.display = '';

  const lapsEl = document.getElementById('run-detail-laps');
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

async function renderMap(detail) {
  if (!detail.hasGps || detail.route.length === 0) return;

  const section = document.getElementById('run-detail-map-section');
  section.style.display = '';

  // Dynamically load Leaflet
  await loadLeaflet();

  const mapEl = document.getElementById('run-detail-map');
  leafletMap = L.map(mapEl, {
    zoomControl: false,
    attributionControl: false,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
  }).addTo(leafletMap);

  const route = detail.route;
  const polyline = L.polyline(route, {
    color: '#CEFF00',
    weight: 3,
    opacity: 0.9,
  }).addTo(leafletMap);

  // Start marker
  L.circleMarker(route[0], {
    radius: 6,
    fillColor: '#00CC66',
    fillOpacity: 1,
    color: '#0D0D0D',
    weight: 2,
  }).addTo(leafletMap);

  // End marker
  L.circleMarker(route[route.length - 1], {
    radius: 6,
    fillColor: '#FF4444',
    fillOpacity: 1,
    color: '#0D0D0D',
    weight: 2,
  }).addTo(leafletMap);

  leafletMap.fitBounds(polyline.getBounds(), { padding: [20, 20] });
}

function loadLeaflet() {
  if (window.L) return Promise.resolve();

  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = resolve;
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

  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-confirm-delete').addEventListener('click', async () => {
    closeModal();
    const shoeId = exercise.shoeId;
    await del('exercises', exercise.id);
    if (shoeId) await recalcShoeKm(shoeId);
    closeRunDetail();
    await renderActivities();
    showToast('Activiteit verwijderd', 'success');
  });
}
