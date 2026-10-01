import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeviceMap, importToast } from '../public/js/import.js';
import { ingest } from '../public/js/intake.js';

/** @typedef {import('../types/domain.ts').Exercise} Exercise */

const fixture = readFileSync(new URL('./fixtures/products-devices.json', import.meta.url), 'utf8');

test('parseDeviceMap names current devices and archived ones via their DELETE event', () => {
  assert.deepEqual(
    parseDeviceMap(fixture),
    new Map([
      ['AAAA0001', 'Polar Pacer'],
      ['BBBB0001', 'Polar Vantage M'],
    ]),
  );
});

test('parseDeviceMap yields an empty map for a malformed file', () => {
  assert.deepEqual(parseDeviceMap('{ not json'), new Map());
  assert.deepEqual(parseDeviceMap('null'), new Map());
  assert.deepEqual(parseDeviceMap('{"devices": 3}'), new Map());
  assert.deepEqual(parseDeviceMap('{}'), new Map());
});

test('importToast keeps the wording for imported, duplicate and overlap', () => {
  assert.deepEqual(importToast({ newExercises: 2, overlaps: 1, total: 5 }, 1), {
    message: '2 geïmporteerd, 1 duplicaat, 1 overlap gemarkeerd',
    type: 'success',
  });
  assert.deepEqual(importToast({ newExercises: 0, overlaps: 0, total: 5 }, 3), {
    message: '3 duplicaat',
    type: 'info',
  });
  assert.deepEqual(importToast({ newExercises: 0, overlaps: 0, total: 5 }, 0), {
    message: 'Geen hardloopactiviteiten gevonden in de bestanden',
    type: 'info',
  });
});

test('an imported Beat + Pacer pair, devices renamed through the map, marks the Beat run as overlap', () => {
  const deviceMap = new Map([['AAAA0001', 'Polar Pacer']]);
  /** @type {Exercise[]} */
  const files = [
    { id: 'import-1', device: 'Polar Beat', 'start-time': '2000-01-01T08:00:00.000', duration: 'PT30M', distance: 5000, 'detailed-sport-info': 'RUNNING' },
    { id: 'import-2', device: 'AAAA0001', 'start-time': '2000-01-01T08:01:00.000', duration: 'PT30M', distance: 5000, 'detailed-sport-info': 'RUNNING' },
  ];
  const imported = files.map((ex) => ({ ...ex, device: deviceMap.get(ex.device ?? '') ?? ex.device }));

  const { toSave, counts } = ingest(imported, { existing: [], shoes: [] });
  assert.equal(toSave.find((e) => e.id === 'import-1')?.overlap, true);
  assert.equal(toSave.find((e) => e.id === 'import-2')?.overlap, undefined);
  assert.equal(importToast(counts, 0).message, '2 geïmporteerd, 1 overlap gemarkeerd');
});
