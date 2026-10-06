import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatTime, formatStart, relativeDay, NO_START } from '../public/js/utils/date.js';
import { polarJsonToExercise, extractTcxMetadata } from '../src/services/importConverters.ts';

/** @typedef {import('../types/domain.ts').Exercise} Exercise */

// The browser's zone, for the starts known only as an instant.
process.env.TZ = 'Europe/Amsterdam';

// One synthetic run, 08:05 local on a UTC+2 day.
const LOCAL_START = '2000-06-01T08:05:00.000';
const UTC_START = '2000-06-01T06:05:00.000Z';

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

test('the three start formats of one run show the same date and time', () => {
  for (const ex of [synced(), fromTcx(), fromJsonExport()]) {
    assert.equal(formatDate(ex), '1 jun 2000');
    assert.equal(formatTime(ex), '08:05');
    assert.equal(formatStart(ex), '1 jun 2000 · 08:05');
  }
});

test('a synced exercise shows its own wall clock, whatever the browser zone', () => {
  // 23:30 in New York is 05:30 the next day in Amsterdam.
  const ex = synced({ 'start-time': '2000-06-01T23:30:00.000', 'start-time-utc-offset': -240 });
  assert.equal(formatStart(ex), '1 jun 2000 · 23:30');
});

test('a TCX start is read in the browser zone, across midnight', () => {
  assert.equal(formatStart(fromTcx('2000-12-31T23:30:00.000Z')), '1 jan 2001 · 00:30');
});

test('no usable start shows the placeholder, never a blank or 1970', () => {
  const noStarts = [fromTcx(null), synced({ 'start-time': 'gisteren' }), synced({ 'start-time': '' })];
  for (const ex of noStarts) {
    assert.equal(formatDate(ex), NO_START);
    assert.equal(formatTime(ex), NO_START);
    assert.equal(formatStart(ex), NO_START);
    assert.equal(relativeDay(ex), NO_START);
  }
  assert.ok(NO_START.length > 0);
});

test('relativeDay counts calendar days in the start time reading', () => {
  const morning = new Date(2000, 5, 1, 9, 0);
  const nextMorning = new Date(2000, 5, 2, 0, 10);
  assert.equal(relativeDay(synced(), morning), 'Vandaag');
  assert.equal(relativeDay(fromTcx(), morning), 'Vandaag');
  assert.equal(relativeDay(fromJsonExport(), nextMorning), 'Gisteren');
  // Late the evening before, under 24 hours ago, is still yesterday.
  const lateEvening = synced({ 'start-time': '2000-05-31T23:50:00.000' });
  assert.equal(relativeDay(lateEvening, morning), 'Gisteren');
  assert.equal(relativeDay(synced(), new Date(2000, 5, 5, 12, 0)), '1 jun 2000');
});
