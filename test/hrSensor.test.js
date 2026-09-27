import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyHrSensor } from '../src/services/hrSensor.ts';

// Synthetic fixtures, see test/fixtures/generate-hr-fixtures.js. These are
// snapshots: if the classifier's constants are recalibrated, update them.
/** @type {(name: string) => string} */
const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf-8');

test('a chest strap-like series', () => {
  const result = classifyHrSensor(fixture('hr-strap.tcx'));
  assert.ok(result);
  assert.equal(result.label, 'chest-strap');
  assert.equal(result.smoothness, -2.27);
  assert.equal(result.features?.samples, 480);
});

test('a wrist-like series', () => {
  const result = classifyHrSensor(fixture('hr-wrist.tcx'));
  assert.ok(result);
  assert.equal(result.label, 'wrist');
  assert.equal(result.smoothness, 3.39);
});

test('too short a series is not classified', () => {
  assert.equal(classifyHrSensor(fixture('hr-short.tcx')), null);
});
