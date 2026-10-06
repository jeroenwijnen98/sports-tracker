import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startOf, startDelta, startGap, compareStart, localStart, localDay, localYear } from '../public/js/utils/startTime.js';
import { polarJsonToExercise, extractTcxMetadata } from '../src/services/importConverters.ts';

/** @typedef {import('../types/domain.ts').Exercise} Exercise */

// The browser's zone, for the starts known only as an instant or a local time.
process.env.TZ = 'Europe/Amsterdam';

// One synthetic run, 08:00 local on a UTC+2 day.
const LOCAL_START = '2000-06-01T08:00:00.000';
const UTC_START = '2000-06-01T06:00:00.000Z';

/** @type {(overrides?: Partial<Exercise>) => Exercise} */
const synced = (overrides = {}) => ({
  id: '1234567',
  'start-time': LOCAL_START,
  'start-time-utc-offset': 120,
  duration: 'PT30M',
  'detailed-sport-info': 'RUNNING',
  ...overrides,
});

/** @type {(startTime?: string) => Exercise} */
const fromJsonExport = (startTime = LOCAL_START) => polarJsonToExercise({
  deviceId: 'AAAA0001',
  exercises: [{ sport: 'RUNNING', startTime, duration: 'PT1800S', distance: 6000 }],
});

/** @type {(id?: string | null) => Exercise} */
const fromTcx = (id = UTC_START) => /** @type {Exercise} */ (extractTcxMetadata(
  `<TrainingCenterDatabase><Activities><Activity Sport="Running">${id ? `<Id>${id}</Id>` : ''}
  <Lap StartTime="${UTC_START}"><TotalTimeSeconds>1800</TotalTimeSeconds><DistanceMeters>6000</DistanceMeters></Lap>
  </Activity></Activities></TrainingCenterDatabase>`,
));

const WALL_CLOCK = Date.parse(`${LOCAL_START}Z`);

test('Polar sync: local time plus offset gives both an instant and a wall clock', () => {
  assert.deepEqual(startOf(synced()), { instant: Date.parse(UTC_START), wallClock: WALL_CLOCK });
});

test('TCX <Id>: UTC with Z gives an instant and no wall clock', () => {
  assert.deepEqual(startOf(fromTcx()), { instant: Date.parse(UTC_START), wallClock: null });
  assert.equal(startOf(fromTcx('2000-06-01T08:00:00+02:00')).instant, Date.parse(UTC_START));
});

test('Polar data export: local time without offset gives only a wall clock', () => {
  assert.deepEqual(startOf(fromJsonExport()), { instant: null, wallClock: WALL_CLOCK });
});

test('no usable start: a TCX without <Id> or an unparsable time gives both null', () => {
  const noId = fromTcx(null);
  assert.equal(noId['start-time'], null);
  assert.deepEqual(startOf(noId), { instant: null, wallClock: null });
  assert.deepEqual(startOf(synced({ 'start-time': 'gisteren' })), { instant: null, wallClock: null });
  assert.deepEqual(startOf(fromTcx('gisteren')), { instant: null, wallClock: null });
});

test('start gap: instants when both have one, across formats', () => {
  assert.equal(startGap(synced(), fromTcx()), 0);
  assert.equal(startGap(fromTcx('2000-06-01T06:00:04.000Z'), synced()), 4000);
  // The <Id> read as if it were local time: two hours apart as instants.
  assert.equal(startGap(synced(), fromTcx('2000-06-01T08:00:00.000Z')), 2 * 60 * 60 * 1000);
});

test('start gap: wall clocks when one side has no offset', () => {
  assert.equal(startGap(synced(), fromJsonExport()), 0);
  assert.equal(startGap(fromJsonExport('2000-06-01T08:00:03.000'), synced()), 3000);
});

test('start gap: null when the starts cannot be compared', () => {
  assert.equal(startGap(fromTcx(), fromJsonExport()), null, 'a UTC instant against a local time');
  assert.equal(startGap(fromTcx(null), synced()), null);
  assert.equal(startGap(synced(), fromTcx(null)), null);
});

/** @type {(exercises: Exercise[]) => (string | null)[]} */
const sortedStarts = (exercises) => [...exercises].sort(compareStart).map((ex) => ex['start-time']);

test('compare start: newest first by the real start, not the string', () => {
  // 06:30Z is 08:30 local, after the synced 08:00; as strings it sorts before.
  const tcx = fromTcx('2000-06-01T06:30:00.000Z');
  assert.deepEqual(sortedStarts([synced(), tcx]), ['2000-06-01T06:30:00.000Z', LOCAL_START]);
  assert.deepEqual(sortedStarts([tcx, synced()]), ['2000-06-01T06:30:00.000Z', LOCAL_START]);
});

test('compare start: an export without offset is read in the browser zone', () => {
  const exported = fromJsonExport('2000-06-01T08:15:00.000');
  const tcx = fromTcx('2000-06-01T06:30:00.000Z');
  assert.deepEqual(
    sortedStarts([synced(), tcx, exported]),
    ['2000-06-01T06:30:00.000Z', '2000-06-01T08:15:00.000', LOCAL_START],
  );
});

test('compare start: exercises without a start come last', () => {
  const noStart = fromTcx(null);
  assert.deepEqual(sortedStarts([noStart, synced(), fromTcx()]).slice(-1), [null]);
  assert.deepEqual(sortedStarts([synced(), noStart]), [LOCAL_START, null]);
  assert.equal(compareStart(noStart, fromTcx(null)), 0);
});

test('local day: the local time when known, across all three formats', () => {
  // Synced 00:30 local on 1 Jan, offset +60: the instant is still 31 Dec in UTC.
  const synced0030 = synced({ 'start-time': '2001-01-01T00:30:00.000', 'start-time-utc-offset': 60 });
  assert.deepEqual(localDay(synced0030), { year: 2001, month: 0, day: 1 });
  assert.deepEqual(localDay(fromJsonExport('2000-12-31T23:30:00.000')), { year: 2000, month: 11, day: 31 });
});

test('local day: an instant only is read in the browser zone', () => {
  // 23:30Z on 31 Dec is 00:30 on 1 Jan in Amsterdam: the next day and year.
  const tcx = fromTcx('2000-12-31T23:30:00.000Z');
  assert.deepEqual(localDay(tcx), { year: 2001, month: 0, day: 1 });
  assert.equal(localYear(tcx), 2001);
});

test('local day and year: null without a start', () => {
  assert.equal(localDay(fromTcx(null)), null);
  assert.equal(localYear(fromTcx(null)), null);
  assert.equal(localYear(synced({ 'start-time': 'gisteren' })), null);
  assert.equal(localYear(synced()), 2000);
});

test('start delta: signed, how much later the second exercise starts', () => {
  const later = fromTcx('2000-06-01T06:00:04.000Z');
  assert.equal(startDelta(synced(), later), 4000);
  assert.equal(startDelta(later, synced()), -4000);
  assert.equal(startDelta(fromJsonExport('2000-06-01T08:00:03.000'), synced()), -3000);
  assert.equal(startDelta(fromTcx(), fromJsonExport()), null);
});

test('localStart: the wall clock when known, else the instant in the browser zone', () => {
  assert.equal(localStart(synced()), WALL_CLOCK);
  assert.equal(localStart(fromJsonExport()), WALL_CLOCK);
  assert.equal(localStart(fromTcx()), WALL_CLOCK);
  assert.equal(localStart(fromTcx(null)), null);
});
