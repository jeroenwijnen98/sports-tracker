// @ts-check

// The run detail chart's numbers: detail data trackpoints turned into plotted
// samples, plus the axis bounds, distance ticks and scrub lookup. No DOM, so
// Node tests import it directly.

/** @typedef {import('../../../types/domain.ts').DetailData} DetailData */
/** @typedef {import('../../../types/domain.ts').Trackpoint} Trackpoint */

/** Samples plotted at most; longer series are downsampled to this. */
const MAX_SAMPLES = 400;
/** Trackpoints on either side used to derive speed when `<Speed>` is missing. */
const SPEED_WINDOW = 4;
/** Samples on either side in the rolling averages. */
const SPEED_SMOOTHING = 6;
const HR_SMOOTHING = 4;
/** Below this speed (m/s) the pace is left as a gap instead of a spike. */
const MIN_SPEED = 1;
/** Slowest pace plotted, in min/km. */
const MAX_PACE = 15;

/**
 * A trackpoint reduced to what the chart needs: seconds since the start and,
 * where known, speed in m/s.
 * @typedef {{ d: number, t: number, hr: number | null, speed: number | null }} ChartPoint
 */

/**
 * One plotted sample: cumulative metres, heart rate and pace in min/km.
 * @typedef {{ d: number, hr: number | null, pace: number | null }} ChartSample
 */

/** @typedef {[min: number, max: number]} Range */

/**
 * @typedef {object} ChartSeries
 * @property {ChartSample[]} samples
 * @property {number} maxD Metres at the last sample.
 * @property {boolean} hasPace
 * @property {boolean} hasHr
 * @property {Range | null} paceRange Min/km; null when no sample has a pace.
 * @property {Range | null} hrRange Beats per minute; null when no sample has a heart rate.
 */

/**
 * Flatten trackpoints into { d, pace, hr } samples. Null when there are fewer
 * than two trackpoints with a time and distance (GPX-only detail data has none).
 * Polar doesn't always record <Speed>, so pace falls back to distance/time deltas.
 *
 * @param {DetailData} detail
 * @returns {ChartSeries | null}
 */
export function buildChartSeries(detail) {
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

  fillMissingSpeed(points);

  // Downsample, then roll a moving average over both metrics.
  points = downsample(points, MAX_SAMPLES);
  points = rollingAverage(points, 'speed', SPEED_SMOOTHING);
  points = rollingAverage(points, 'hr', HR_SMOOTHING);

  const samples = points.map((p) => ({
    d: p.d,
    hr: p.hr,
    pace: p.speed !== null && p.speed > MIN_SPEED ? Math.min(1000 / 60 / p.speed, MAX_PACE) : null,
  }));

  const paces = samples.map((p) => p.pace).filter(/** @returns {v is number} */ (v) => v !== null);
  const hrs = samples.map((p) => p.hr).filter(/** @returns {v is number} */ (v) => !!v);

  return {
    samples,
    maxD: samples[samples.length - 1].d || 1,
    hasPace: paces.length > 0,
    hasHr: hrs.length > 0,
    paceRange: range(paces),
    hrRange: range(hrs),
  };
}

/**
 * Derive speed from distance/time over a window of trackpoints wherever
 * `<Speed>` is missing. Mutates `points`.
 * @param {ChartPoint[]} points
 */
function fillMissingSpeed(points) {
  for (let i = 0; i < points.length; i++) {
    if (points[i].speed !== null) continue;
    const a = points[Math.max(0, i - SPEED_WINDOW)];
    const b = points[Math.min(points.length - 1, i + SPEED_WINDOW)];
    points[i].speed = b.t > a.t ? (b.d - a.d) / (b.t - a.t) : null;
  }
}

/**
 * Pick `count` evenly spaced points, always keeping the first and the last.
 * @param {ChartPoint[]} points
 * @param {number} count
 * @returns {ChartPoint[]}
 */
function downsample(points, count) {
  if (points.length <= count) return points;
  const step = (points.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => points[Math.round(i * step)]);
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
 * @param {number[]} values
 * @returns {Range | null}
 */
function range(values) {
  if (values.length === 0) return null;
  return [Math.min(...values), Math.max(...values)];
}

/**
 * A metric's range padded by 8% on both sides, so the line never touches the
 * plot's edge. A flat range is padded as if it were 1 wide.
 * @param {Range} range
 * @returns {Range}
 */
export function axisBounds([min, max]) {
  const span = max - min || 1;
  return [min - span * 0.08, max + span * 0.08];
}

/**
 * Kilometres between labels on the distance axis.
 * @param {number} kmMax The run's distance in km.
 * @returns {number}
 */
export function kmTickStep(kmMax) {
  if (kmMax <= 3) return 0.5;
  if (kmMax <= 8) return 1;
  if (kmMax <= 20) return 2;
  return 5;
}

/**
 * The sample closest to `d` metres, for the scrub cursor.
 * @param {ChartSeries} series
 * @param {number} d
 * @returns {ChartSample}
 */
export function nearestSample(series, d) {
  let sample = series.samples[0];
  for (const candidate of series.samples) {
    if (Math.abs(candidate.d - d) < Math.abs(sample.d - d)) sample = candidate;
  }
  return sample;
}
