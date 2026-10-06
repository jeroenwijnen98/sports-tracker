import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodData } from '../public/js/utils/activityPeriods.js';

/** @typedef {import('../types/domain.ts').Exercise} Exercise */

// The browser's zone, for the TCX starts known only as an instant.
process.env.TZ = 'Europe/Amsterdam';

/** @type {(id: string, start: string | null, distance?: number) => Exercise} */
const run = (id, start, distance = 10000) => /** @type {Exercise} */ ({
  id,
  'start-time': start,
  duration: 'PT50M',
  distance,
  'detailed-sport-info': 'RUNNING',
});

// Wednesday 7 October 2026, local time.
const NOW = new Date(2026, 9, 7, 12, 0);

test('All mode: an exercise without a start does not reach back to 1970', () => {
  const { bars, periodLabel, filtered } = periodData('All', [
    run('a', '2024-05-01T08:00:00.000'),
    run('b', null),
  ], NOW);

  assert.deepEqual(bars.map((b) => b.year), [2024, 2025, 2026]);
  assert.equal(periodLabel, '2024–2026');
  assert.deepEqual(filtered.map((ex) => ex.id), ['a']);
});

test('All mode: only exercises without a start is the empty chart', () => {
  const { bars, periodLabel } = periodData('All', [run('b', null)], NOW);
  assert.deepEqual(bars, [{ km: 0, label: '2026' }]);
  assert.equal(periodLabel, '2026');
});

test('All mode: a UTC start is bucketed by its year in the browser zone', () => {
  const { bars } = periodData('All', [run('a', '2025-12-31T23:30:00.000Z')], NOW);
  assert.deepEqual(bars.map((b) => [b.year, b.km]), [[2026, 10]]);
});

test('week mode: buckets by local day, Monday first', () => {
  const { bars, filtered } = periodData('W', [
    run('mon', '2026-10-05T07:00:00.000'),
    run('sun', '2026-10-11T22:30:00.000Z', 5000), // Monday 00:30 local: next week
    run('wed', '2026-10-07T06:00:00.000Z', 8000),
    run('prev', '2026-10-04T21:00:00.000'),
    run('none', null),
  ], NOW);

  assert.deepEqual(filtered.map((ex) => ex.id), ['mon', 'wed']);
  assert.deepEqual(bars.map((b) => b.km), [10, 0, 8, 0, 0, 0, 0]);
});

test('month mode: buckets by local day in steps of seven', () => {
  const { bars, filtered, periodLabel } = periodData('M', [
    run('a', '2026-10-01T08:00:00.000'),
    run('b', '2026-10-08T08:00:00.000', 4000),
    run('c', '2026-09-30T22:30:00.000Z', 3000), // 1 October 00:30 local
    run('d', '2026-09-30T08:00:00.000'),
    run('none', null),
  ], NOW);

  assert.equal(periodLabel, 'Oktober 2026');
  assert.deepEqual(filtered.map((ex) => ex.id), ['a', 'b', 'c']);
  assert.deepEqual(bars.map((b) => b.label), ['1', '8', '15', '22', '29']);
  assert.deepEqual(bars.map((b) => b.km), [13, 4, 0, 0, 0]);
});

test('year mode: the last twelve months by local month', () => {
  const { bars, filtered, periodLabel } = periodData('Y', [
    run('a', '2025-11-01T08:00:00.000'),
    run('b', '2025-10-31T23:30:00.000Z', 2000), // 1 November local
    run('c', '2025-10-31T08:00:00.000'),
    run('none', null),
  ], NOW);

  assert.equal(periodLabel, 'nov 2025 – okt 2026');
  assert.deepEqual(filtered.map((ex) => ex.id), ['a', 'b']);
  assert.equal(bars[0].key, '2025-11');
  assert.equal(bars[0].km, 12);
  assert.equal(bars.reduce((sum, b) => sum + b.km, 0), 12);
});
