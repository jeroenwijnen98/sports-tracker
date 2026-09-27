import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  polarJsonToTcx,
  polarJsonToExercise,
  extractTcxMetadata,
  parsePTSeconds,
} from '../src/services/importConverters.ts';
import { parseISODuration } from '../public/js/utils/format.js';

const START = '2000-01-01T08:00:00.000';

// A synthetic Polar data export training session: 20 minutes, 4 km, with a
// route placed around 0,0 so it resembles no real run.
function session({ laps = [], sport = 'RUNNING' } = {}) {
  const heartRate = [];
  const speed = [];
  const distance = [];
  const recordedRoute = [];
  for (let i = 0; i <= 1200; i += 10) {
    const dateTime = new Date(Date.parse(`${START}Z`) + i * 1000).toISOString().replace('Z', '');
    heartRate.push({ dateTime, value: 140 + (i % 30) });
    speed.push({ dateTime, value: 12 });
    distance.push({ dateTime, value: (i * 10) / 3 });
    recordedRoute.push({ dateTime, latitude: 0.0001 * i, longitude: 0.0002 * i, altitude: 10 });
  }
  return {
    deviceId: 'ABC123',
    exercises: [{
      sport,
      startTime: START,
      duration: 'PT1200S',
      distance: 4000.4,
      kiloCalories: 300,
      heartRate: { avg: 152, max: 171 },
      laps,
      samples: { heartRate, speed, distance, recordedRoute },
    }],
  };
}

test('JSON → TCX → metadata keeps distance, duration and heart rate', () => {
  const json = session();
  const meta = extractTcxMetadata(polarJsonToTcx(json));
  const exercise = polarJsonToExercise(json);

  assert.equal(meta.distance, 4000);
  assert.equal(meta.distance, exercise.distance);
  assert.equal(parseISODuration(meta.duration), 1200);
  assert.equal(parseISODuration(meta.duration), parseISODuration(exercise.duration));
  assert.deepEqual(meta['heart-rate'], { average: 152, maximum: 171 });
  assert.equal(meta.calories, 300);
  assert.equal(meta['start-time'], START);
  assert.equal(meta['detailed-sport-info'], 'RUNNING');
});

test('JSON → TCX → metadata with laps sums the laps', () => {
  const lap = (n) => ({
    duration: 'PT600S',
    splitTime: `PT${600 * n}S`,
    distance: 2000,
    heartRate: { avg: 150, max: 160 + n },
  });
  const tcx = polarJsonToTcx(session({ laps: [lap(1), lap(2)] }));
  const meta = extractTcxMetadata(tcx);

  assert.equal((tcx.match(/<Lap /g) || []).length, 2);
  assert.equal(meta.distance, 4000);
  assert.equal(parseISODuration(meta.duration), 1200);
  assert.deepEqual(meta['heart-rate'], { average: 150, maximum: 162 });
  // Every trackpoint lands in exactly one lap
  assert.equal((tcx.match(/<Trackpoint>/g) || []).length, 121);
});

test('the TCX and JSON imports of one run get the same id', () => {
  const json = session();
  assert.equal(extractTcxMetadata(polarJsonToTcx(json)).id, polarJsonToExercise(json).id);
  assert.match(polarJsonToExercise(json).id, /^import-[0-9a-f]{16}$/);
});

test('polarJsonToExercise maps the sport and the device', () => {
  const trail = polarJsonToExercise(session({ sport: 'TRAIL_RUNNING' }));
  assert.equal(trail['detailed-sport-info'], 'TRAIL_RUNNING');
  assert.equal(trail.device, 'ABC123');
  assert.equal(trail.source, 'json-import');

  const cycling = polarJsonToExercise(session({ sport: 'CYCLING' }));
  assert.equal(cycling['detailed-sport-info'], 'CYCLING');

  const phone = session();
  delete phone.deviceId;
  assert.equal(polarJsonToExercise(phone).device, 'Polar Beat');
});

test('polarJsonToTcx writes the TCX sport and rejects a session without exercise', () => {
  assert.match(polarJsonToTcx(session()), /<Activity Sport="Running">/);
  assert.match(polarJsonToTcx(session({ sport: 'ROAD_BIKING' })), /<Activity Sport="Biking">/);
  assert.match(polarJsonToTcx(session({ sport: 'YOGA' })), /<Activity Sport="Other">/);
  assert.throws(() => polarJsonToTcx({ exercises: [] }), /No exercise/);
});

test('extractTcxMetadata reads a TCX without heart rate', () => {
  const xml = `<TrainingCenterDatabase><Activities><Activity Sport="Biking">
    <Id>2000-01-02T09:00:00.000Z</Id>
    <Lap StartTime="2000-01-02T09:00:00.000Z"><TotalTimeSeconds>3725.4</TotalTimeSeconds>
    <DistanceMeters>30000.6</DistanceMeters></Lap></Activity></Activities></TrainingCenterDatabase>`;
  const meta = extractTcxMetadata(xml);
  assert.equal(meta['detailed-sport-info'], 'CYCLING');
  assert.equal(meta.duration, 'PT1H2M5S');
  assert.equal(meta.distance, 30001);
  assert.equal(meta['heart-rate'], undefined);
  assert.equal(meta.calories, undefined);
  assert.equal(meta.source, 'tcx-import');
});

test('parsePTSeconds reads Polar export durations', () => {
  assert.equal(parsePTSeconds('PT1200S'), 1200);
  assert.equal(parsePTSeconds('PT61.5S'), 61.5);
  assert.equal(parsePTSeconds('garbage'), 0);
});
