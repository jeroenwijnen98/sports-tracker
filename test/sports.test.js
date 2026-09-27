import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUNNING_SPORTS, isRunningSport, isRunningSportName } from '../public/js/utils/sports.js';
import { sportLabel } from '../public/js/utils/format.js';
import { polarJsonToExercise } from '../src/services/importConverters.js';

test('the running sports are road, trail, treadmill and ultra running', () => {
  assert.deepEqual(RUNNING_SPORTS, ['RUNNING', 'TRAIL_RUNNING', 'TREADMILL_RUNNING', 'ULTRARUNNING_RUNNING']);
});

test('isRunningSport reads detailed-sport-info', () => {
  for (const sport of RUNNING_SPORTS) {
    assert.equal(isRunningSport({ 'detailed-sport-info': sport }), true);
  }
  assert.equal(isRunningSport({ 'detailed-sport-info': 'CYCLING' }), false);
  assert.equal(isRunningSport({}), false);
});

test('isRunningSportName accepts only the running sports', () => {
  for (const sport of RUNNING_SPORTS) assert.equal(isRunningSportName(sport), true);
  assert.equal(isRunningSportName('CYCLING'), false);
  assert.equal(isRunningSportName('toString'), false);
  assert.equal(isRunningSportName(undefined), false);
});

test('sportLabel names each running sport', () => {
  assert.deepEqual(RUNNING_SPORTS.map(sportLabel), ['Run', 'Trail Run', 'Treadmill', 'Ultra Run']);
  assert.equal(sportLabel('CYCLING'), 'CYCLING');
  assert.equal(sportLabel(undefined), 'Run');
  assert.equal(sportLabel('toString'), 'toString');
});

test('a Polar data export keeps its sport name', () => {
  const session = (sport) => ({ exercises: [{ sport, startTime: '2000-01-01T08:00:00.000' }] });
  assert.equal(polarJsonToExercise(session('TRAIL_RUNNING'))['detailed-sport-info'], 'TRAIL_RUNNING');
  assert.equal(polarJsonToExercise(session('CYCLING'))['detailed-sport-info'], 'CYCLING');
  assert.equal(polarJsonToExercise(session(undefined))['detailed-sport-info'], 'OTHER');
});
