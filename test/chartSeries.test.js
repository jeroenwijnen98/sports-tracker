import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChartSeries, axisBounds, kmTickStep, nearestSample } from '../public/js/utils/chartSeries.js';

/** @typedef {import('../types/domain.ts').DetailData} DetailData */
/** @typedef {import('../types/domain.ts').Trackpoint} Trackpoint */

const START = Date.parse('2026-09-01T07:00:00Z');

/**
 * One trackpoint per second at `speedAt(i)` m/s.
 * @param {number} count
 * @param {{ speedAt?: (i: number) => number, hr?: number | null, withSpeed?: boolean }} [options]
 * @returns {Trackpoint[]}
 */
function trackpoints(count, { speedAt = () => 3, hr = 150, withSpeed = true } = {}) {
  /** @type {Trackpoint[]} */
  const points = [];
  let distance = 0;
  for (let i = 0; i < count; i++) {
    if (i > 0) distance += speedAt(i);
    points.push({
      time: new Date(START + i * 1000).toISOString(),
      lat: null,
      lon: null,
      heartRate: hr,
      speed: withSpeed ? speedAt(i) : null,
      distance,
    });
  }
  return points;
}

/**
 * @param {Trackpoint[]} allTrackpoints
 * @returns {DetailData}
 */
function detail(allTrackpoints) {
  return {
    laps: [],
    allTrackpoints,
    route: [],
    hasGps: false,
    hasHeartRate: allTrackpoints.some((tp) => tp.heartRate !== null),
    hasSpeed: allTrackpoints.some((tp) => tp.speed !== null),
  };
}

test('trackpoints without <Speed> get a pace derived from distance and time', () => {
  const series = buildChartSeries(detail(trackpoints(60, { withSpeed: false })));
  assert.ok(series);
  assert.equal(series.hasPace, true);
  // 3 m/s is 5:33 min/km
  for (const sample of series.samples) assert.ok(Math.abs(/** @type {number} */ (sample.pace) - 1000 / 60 / 3) < 1e-9);
  assert.ok(series.paceRange);
});

test('standing still (below 1 m/s) leaves a pace gap', () => {
  const speedAt = (/** @type {number} */ i) => (i >= 100 && i < 140 ? 0.5 : 3);
  const series = buildChartSeries(detail(trackpoints(240, { speedAt })));
  assert.ok(series);
  const stopped = nearestSample(series, series.samples[120].d);
  assert.equal(stopped.pace, null);
  assert.notEqual(series.samples[0].pace, null);
  assert.notEqual(series.samples[series.samples.length - 1].pace, null);
});

test('downsampling a long series keeps the last distance', () => {
  const points = trackpoints(1003);
  const series = buildChartSeries(detail(points));
  assert.ok(series);
  assert.equal(series.samples.length, 400);
  assert.equal(series.samples[0].d, 0);
  assert.equal(series.maxD, points[points.length - 1].distance);
  assert.equal(series.samples[series.samples.length - 1].d, points[points.length - 1].distance);
});

test('heart-rate-only detail data has no pace and a null pace range', () => {
  const points = trackpoints(30, { speedAt: () => 0, withSpeed: false });
  const series = buildChartSeries(detail(points));
  assert.ok(series);
  assert.equal(series.hasPace, false);
  assert.equal(series.paceRange, null);
  assert.equal(series.hasHr, true);
  assert.deepEqual(series.hrRange, [150, 150]);
});

test('detail data without heart rate has a null heart rate range', () => {
  const series = buildChartSeries(detail(trackpoints(30, { hr: null })));
  assert.ok(series);
  assert.equal(series.hasHr, false);
  assert.equal(series.hrRange, null);
});

test('GPX-only detail data (no trackpoints) gives no series', () => {
  assert.equal(buildChartSeries({ ...detail([]), route: [[52, 5], [52.001, 5.001]], hasGps: true }), null);
});

test('a single trackpoint gives no series', () => {
  assert.equal(buildChartSeries(detail(trackpoints(1))), null);
});

test('axisBounds pads the range by 8% and a flat range as if it were 1 wide', () => {
  const [lo, hi] = axisBounds([100, 200]);
  assert.ok(Math.abs(lo - 92) < 1e-9);
  assert.ok(Math.abs(hi - 208) < 1e-9);
  assert.deepEqual(axisBounds([150, 150]), [149.92, 150.08]);
});

test('kmTickStep widens with the distance', () => {
  assert.equal(kmTickStep(2), 0.5);
  assert.equal(kmTickStep(3), 0.5);
  assert.equal(kmTickStep(5), 1);
  assert.equal(kmTickStep(10), 2);
  assert.equal(kmTickStep(21.1), 5);
  assert.equal(kmTickStep(42.2), 5);
});

test('nearestSample picks the sample closest to a distance', () => {
  const series = {
    samples: [
      { d: 0, hr: 120, pace: 6 },
      { d: 100, hr: 130, pace: 5.5 },
      { d: 250, hr: 140, pace: null },
    ],
    maxD: 250,
    hasPace: true,
    hasHr: true,
    paceRange: /** @type {[number, number]} */ ([5.5, 6]),
    hrRange: /** @type {[number, number]} */ ([120, 140]),
  };
  assert.equal(nearestSample(series, -10).d, 0);
  assert.equal(nearestSample(series, 40).d, 0);
  assert.equal(nearestSample(series, 60).d, 100);
  assert.equal(nearestSample(series, 200).d, 250);
  assert.equal(nearestSample(series, 1000).d, 250);
});
