import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDetailLoader, RETRY_AFTER_MS } from '../public/js/services/detailData.js';
import { splitDetailData } from '../public/js/db.js';

/** @typedef {import('../types/domain.ts').DetailData} DetailData */
/** @typedef {import('../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../public/js/db.js').DetailsEntry} DetailsEntry */

/** @type {DetailData} */
const parsed = {
  laps: [{ index: 1, duration: 600, distance: 2000, avgHR: 150, maxHR: 160 }],
  allTrackpoints: [],
  route: [[52.1, 5.1]],
  hasGps: true,
  hasHeartRate: true,
  hasSpeed: true,
};

/** @type {Exercise} */
const exercise = {
  id: 'a',
  'start-time': '2000-01-01T08:00:00.000',
  duration: 'PT30M',
  'detailed-sport-info': 'RUNNING',
};

/**
 * An in-memory IndexedDB with the exercises and details stores, a clock and
 * counting fetchers. `tcx` and `gpx` say what the server has.
 *
 * @param {{ tcx?: DetailData | null, gpx?: Pick<DetailData, 'route' | 'hasGps'> | null, entries?: DetailsEntry[] }} [options]
 */
function setup({ tcx = parsed, gpx = null, entries = [] } = {}) {
  const db = {
    /** @type {Map<string, Exercise>} */
    exercises: new Map([[exercise.id, exercise]]),
    details: new Map(entries.map((e) => [e.id, e])),
  };
  const calls = { tcx: 0, gpx: 0 };
  const clock = { now: 1_000_000 };
  /** @type {(() => void)[]} */
  const releases = [];
  let hold = false;

  const { load, forget } = createDetailLoader({
    store: {
      get: async (id) => db.details.get(id),
      put: async (entry) => { db.details.set(entry.id, entry); },
      delete: async (id) => { db.details.delete(id); },
    },
    fetchTcx: async () => {
      calls.tcx++;
      if (hold) await new Promise((resolve) => releases.push(() => resolve(undefined)));
      return tcx;
    },
    fetchGpx: async () => {
      calls.gpx++;
      return gpx;
    },
    now: () => clock.now,
  });

  return { load, forget, db, calls, clock, holdFetches: () => { hold = true; }, release: () => releases.forEach((r) => r()) };
}

test('stored detail data is returned without a fetch', async () => {
  const { load, calls } = setup({ entries: [{ id: 'a', detail: parsed }] });
  assert.deepEqual(await load('a'), parsed);
  assert.deepEqual(calls, { tcx: 0, gpx: 0 });
});

test('a fetched TCX is stored, and the next load reads it from the store', async () => {
  const { load, db, calls } = setup();
  assert.deepEqual(await load('a'), parsed);
  assert.deepEqual(db.details.get('a'), { id: 'a', detail: parsed });
  await load('a');
  assert.deepEqual(calls, { tcx: 1, gpx: 0 });
});

test('an unavailable marker younger than the TTL returns null without a fetch', async () => {
  const { load, calls, clock } = setup({ entries: [{ id: 'a', unavailable: true, checkedAt: 1_000_000 }] });
  clock.now += RETRY_AFTER_MS - 1;
  assert.equal(await load('a'), null);
  assert.deepEqual(calls, { tcx: 0, gpx: 0 });
});

test('an unavailable marker older than the TTL is fetched again', async () => {
  const { load, calls, clock } = setup({ entries: [{ id: 'a', unavailable: true, checkedAt: 1_000_000 }] });
  clock.now += RETRY_AFTER_MS;
  assert.deepEqual(await load('a'), parsed);
  assert.equal(calls.tcx, 1);
});

test('force fetches regardless of a fresh unavailable marker', async () => {
  const { load, calls } = setup({ entries: [{ id: 'a', unavailable: true, checkedAt: 1_000_000 }] });
  assert.deepEqual(await load('a', { force: true }), parsed);
  assert.equal(calls.tcx, 1);
});

test('two concurrent loads of the same id make one TCX fetch', async () => {
  const { load, calls } = setup();
  const [first, second] = await Promise.all([load('a'), load('a')]);
  assert.deepEqual(first, parsed);
  assert.equal(second, first);
  assert.equal(calls.tcx, 1);
});

test('GPX is not fetched when there is a TCX', async () => {
  const { load, calls } = setup({ gpx: { route: [[1, 2]], hasGps: true } });
  await load('a');
  assert.deepEqual(calls, { tcx: 1, gpx: 0 });
});

test('without a TCX the GPX route is used', async () => {
  const { load, calls } = setup({ tcx: null, gpx: { route: [[1, 2]], hasGps: true } });
  assert.deepEqual(await load('a'), {
    route: [[1, 2]], hasGps: true, laps: [], allTrackpoints: [], hasHeartRate: false, hasSpeed: false,
  });
  assert.deepEqual(calls, { tcx: 1, gpx: 1 });
});

test('with neither TCX nor GPX an unavailable marker is stored', async () => {
  const { load, db } = setup({ tcx: null });
  assert.equal(await load('a'), null);
  assert.deepEqual(db.details.get('a'), { id: 'a', unavailable: true, checkedAt: 1_000_000 });
});

test('a load finishing after its exercise was deleted does not bring the exercise back', async () => {
  const { load, db, holdFetches, release } = setup();
  holdFetches();
  const pending = load('a');
  await new Promise((resolve) => setImmediate(resolve));

  db.exercises.delete('a');
  release();
  await pending;

  assert.equal(db.exercises.has('a'), false);
});

test('forget removes the details entry of an exercise', async () => {
  const { forget, db } = setup({ entries: [{ id: 'a', detail: parsed }, { id: 'b', detail: parsed }] });
  await forget('a');
  assert.equal(db.details.has('a'), false);
  assert.equal(db.details.has('b'), true);
});

test('forget waits for a load still in flight, so it leaves no entry behind', async () => {
  const { load, forget, db, holdFetches, release } = setup();
  holdFetches();
  const pending = load('a');
  await new Promise((resolve) => setImmediate(resolve));

  const forgotten = forget('a');
  release();
  await Promise.all([pending, forgotten]);

  assert.equal(db.details.has('a'), false);
});

test('the migration moves detail data off a version 1 exercise', () => {
  const { exercise: stripped, entry } = splitDetailData({ ...exercise, shoeId: 1, detailData: parsed });
  assert.deepEqual(stripped, { ...exercise, shoeId: 1 });
  assert.deepEqual(entry, { id: 'a', detail: parsed });
});

test('the migration normalises an old marker with timestamp to checkedAt', () => {
  assert.deepEqual(splitDetailData({ ...exercise, detailData: { unavailable: true, timestamp: 5 } }).entry,
    { id: 'a', unavailable: true, checkedAt: 5 });
  assert.deepEqual(splitDetailData({ ...exercise, detailData: { unavailable: true, checkedAt: 7 } }).entry,
    { id: 'a', unavailable: true, checkedAt: 7 });
});

test('an exercise without detail data has no entry', () => {
  assert.deepEqual(splitDetailData(exercise), { exercise, entry: null });
});
