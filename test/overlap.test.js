import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markOverlaps } from '../public/js/utils/overlap.js';

/** @typedef {import('../types/domain.ts').Exercise} Exercise */

/** @type {(id: string, device: string | undefined, start: string, duration?: string) => Exercise} */
const run = (id, device, start, duration = 'PT30M') => ({
  id,
  device,
  'start-time': `2000-01-01T${start}:00.000`,
  duration,
  'detailed-sport-info': 'RUNNING',
});

test('phone and watch recording within the window: the phone one overlaps', () => {
  const phone = run('p', 'Polar Beat', '08:00');
  const watch = run('w', 'Polar Pacer', '08:03');
  const { imported, updatedExisting, count } = markOverlaps([phone, watch], []);

  assert.equal(imported.find((e) => e.id === 'p')?.overlap, true);
  assert.equal(imported.find((e) => e.id === 'w')?.overlap, undefined);
  assert.deepEqual(updatedExisting, []);
  assert.equal(count, 1);
});

test('a phone recording without device counts as phone', () => {
  const { count } = markOverlaps([run('p', undefined, '08:00'), run('w', 'Polar Pacer', '08:00')], []);
  assert.equal(count, 1);
});

test('starts outside the window do not overlap', () => {
  const { imported, count } = markOverlaps(
    [run('p', 'Polar Beat', '08:00'), run('w', 'Polar Pacer', '08:05')],
    [],
  );
  assert.equal(count, 0);
  assert.ok(imported.every((e) => !e.overlap));
});

test('two watch recordings are never overlap', () => {
  const { count } = markOverlaps(
    [run('a', 'Polar Pacer', '08:00'), run('b', 'Polar Vantage', '08:01')],
    [run('c', 'Polar Pacer', '08:02')],
  );
  assert.equal(count, 0);
});

test('importing phone when a watch recording is already stored', () => {
  const { imported, updatedExisting, count } = markOverlaps(
    [run('p', 'Polar Beat', '08:02')],
    [run('w', 'Polar Pacer', '08:00')],
  );
  assert.equal(imported[0].overlap, true);
  assert.deepEqual(updatedExisting, []);
  assert.equal(count, 1);
});

test('importing watch when a phone recording is already stored', () => {
  const stored = run('p', 'Polar Beat', '08:02');
  const { imported, updatedExisting, count } = markOverlaps([run('w', 'Polar Pacer', '08:00')], [stored]);

  assert.equal(imported[0].overlap, undefined);
  assert.deepEqual(updatedExisting, [{ ...stored, overlap: true }]);
  assert.equal(count, 1);
  assert.equal(stored.overlap, undefined, 'inputs are not mutated');
});

test('a stored phone recording already marked is left alone', () => {
  const { updatedExisting, count } = markOverlaps(
    [run('w', 'Polar Pacer', '08:00')],
    [{ ...run('p', 'Polar Beat', '08:02'), overlap: true }],
  );
  assert.deepEqual(updatedExisting, []);
  assert.equal(count, 0);
});

test('a stored phone recording is marked once for two overlapping watches', () => {
  const { updatedExisting, count } = markOverlaps(
    [run('w1', 'Polar Pacer', '08:00'), run('w2', 'Polar Vantage', '08:01')],
    [run('p', 'Polar Beat', '08:02')],
  );
  assert.equal(updatedExisting.length, 1);
  assert.equal(count, 1);
});
