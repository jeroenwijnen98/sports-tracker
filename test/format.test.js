import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseISODuration, formatPace, formatDuration } from '../public/js/utils/format.js';

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

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3599.9), '59:59');
  assert.equal(formatDuration(5025), '1:23:45');
});
