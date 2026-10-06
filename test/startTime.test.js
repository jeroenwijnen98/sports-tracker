import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startOf, startGap } from '../public/js/utils/startTime.js';
import { polarJsonToExercise, extractTcxMetadata } from '../src/services/importConverters.ts';

/** @typedef {import('../types/domain.ts').Exercise} Exercise */

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
  assert.deepEqual(startOf(fromTcx('2000-06-01T08:00:00+02:00')).instant, Date.parse(UTC_START));
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
