import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseISODuration, formatPace, formatDuration, paceParts } from '../public/js/utils/format.js';

test('parseISODuration', () => {
  assert.equal(parseISODuration('PT1H23M45S'), 5025);
  assert.equal(parseISODuration('PT45M'), 2700);
  assert.equal(parseISODuration('PT30.5S'), 30.5);
  assert.equal(parseISODuration('PT2H'), 7200);
  assert.equal(parseISODuration(''), 0);
  assert.equal(parseISODuration(undefined), 0);
  assert.equal(parseISODuration('nonsense'), 0);
});

test('formatPace gives min:sec per km', () => {
  assert.equal(formatPace(1500, 5000), '5:00');
  assert.equal(formatPace(1545, 5000), '5:09');
  assert.equal(formatPace(3600, 10000), '6:00');
  assert.equal(formatPace(600, 0), '--:--');
  assert.equal(formatPace(600, undefined), '--:--');
});

test('formatPace rounds to the nearest second and carries into the minutes', () => {
  // 359.7 s/km: rounds up to 6:00, never 5:60
  assert.equal(formatPace(3597, 10000), '6:00');
  // 309.4 s/km rounds down, 309.5 rounds up
  assert.equal(formatPace(1547, 5000), '5:09');
  assert.equal(formatPace(1547.5, 5000), '5:10');
});

test('paceParts never gives 60 seconds', () => {
  assert.deepEqual(paceParts(359.5), { min: 6, sec: '00' });
  assert.deepEqual(paceParts(359.4), { min: 5, sec: '59' });
  assert.deepEqual(paceParts(65), { min: 1, sec: '05' });
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3599.9), '59:59');
  assert.equal(formatDuration(5025), '1:23:45');
});
