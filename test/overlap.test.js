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

// One run at 08:00 local in UTC-5, away from home: the phone synced from Polar
// with its offset, the watch imported as a TCX whose <Id> is UTC.
/** @type {Exercise} */
const syncedPhone = {
  id: '1234567',
  device: 'Polar Beat',
  'start-time': '2000-06-01T08:00:00.000',
  'start-time-utc-offset': -300,
  duration: 'PT30M',
  'detailed-sport-info': 'RUNNING',
};
/** @type {Exercise} */
const tcxWatch = {
  id: 'import-w',
  source: 'tcx-import',
  device: 'Polar Pacer',
  'start-time': '2000-06-01T13:02:00.000Z',
  duration: 'PT30M',
  'detailed-sport-info': 'RUNNING',
};

test('a Polar-synced phone recording with offset against a UTC TCX watch: the phone overlaps', () => {
  const batch = markOverlaps([syncedPhone, tcxWatch], []);
  assert.equal(batch.imported.find((e) => e.id === syncedPhone.id)?.overlap, true);
  assert.equal(batch.count, 1);

  const stored = markOverlaps([tcxWatch], [syncedPhone]);
  assert.deepEqual(stored.updatedExisting, [{ ...syncedPhone, overlap: true }]);
});

test('the local clock time read as UTC is five hours off, not an overlap', () => {
  const { count } = markOverlaps(
    [syncedPhone, { ...tcxWatch, 'start-time': '2000-06-01T08:02:00.000Z' }],
    [],
  );
  assert.equal(count, 0);
});

test('an exercise without a start is never marked and never marks another', () => {
  /** @type {Exercise} */
  const noStart = { ...run('n', 'Polar Beat', '08:00'), 'start-time': '' };
  const phoneFirst = markOverlaps([noStart, run('w', 'Polar Pacer', '08:00')], []);
  assert.equal(phoneFirst.count, 0);

  const watchNoStart = { ...noStart, id: 'nw', device: 'Polar Pacer' };
  const watchFirst = markOverlaps([watchNoStart], [run('p', 'Polar Beat', '08:00')]);
  assert.equal(watchFirst.count, 0);
  assert.deepEqual(watchFirst.updatedExisting, []);

  const stored = markOverlaps([run('p', 'Polar Beat', '08:00')], [watchNoStart]);
  assert.equal(stored.count, 0);
});

test('a UTC instant against a local time without offset is never an overlap', () => {
  const { count } = markOverlaps([run('p', 'Polar Beat', '08:00'), tcxWatch], []);
  assert.equal(count, 0);
});
