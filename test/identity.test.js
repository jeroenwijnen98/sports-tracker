import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingest } from '../public/js/intake.js';
import { importToast } from '../public/js/import.js';
import { sameExercise } from '../public/js/utils/identity.js';
import { polarJsonToExercise, extractTcxMetadata } from '../src/services/importConverters.ts';

/** @typedef {import('../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../types/domain.ts').Shoe} Shoe */

// One synthetic run, 08:00 local on a UTC+2 day, 30:12.5 long.
const LOCAL_START = '2000-06-01T08:00:00.000';
const UTC_START = '2000-06-01T06:00:00.000Z';

/** @type {(overrides?: Partial<Exercise>) => Exercise} */
const synced = (overrides = {}) => ({
  id: '1234567',
  'start-time': LOCAL_START,
  'start-time-utc-offset': 120,
  duration: 'PT30M12.5S',
  distance: 6000,
  device: 'Polar Pacer',
  'detailed-sport-info': 'RUNNING',
  ...overrides,
});

/** @type {(startTime?: string, duration?: string) => Exercise} */
const fromJsonExport = (startTime = LOCAL_START, duration = 'PT1812.5S') => polarJsonToExercise({
  deviceId: 'AAAA0001',
  exercises: [{ sport: 'RUNNING', startTime, duration, distance: 6000 }],
});

/** @type {(id?: string, seconds?: number) => Exercise} */
const fromTcx = (id = UTC_START, seconds = 1812.5) => /** @type {Exercise} */ (extractTcxMetadata(
  `<TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>${id}</Id>
  <Lap StartTime="${id}"><TotalTimeSeconds>${seconds}</TotalTimeSeconds><DistanceMeters>6000</DistanceMeters></Lap>
  </Activity></Activities></TrainingCenterDatabase>`,
));

/** @type {Shoe[]} */
const shoes = [{ id: 1, name: 'Schoen', initialKm: 0, isDefault: true }];

test('an imported JSON export of a run stored from Polar sync is not stored twice', () => {
  const stored = { ...synced(), shoeId: 7, overlap: false };
  const { toSave, updatedExisting, counts } = ingest([fromJsonExport()], { existing: [stored], shoes });

  assert.deepEqual(toSave, []);
  assert.deepEqual(updatedExisting, []);
  assert.deepEqual(counts, { newExercises: 0, overlaps: 0, duplicates: 1, total: 1 });
  assert.equal(importToast(counts, 0).message, '1 duplicaat');
});

test('an imported TCX (UTC <Id>) of a run stored from Polar sync is not stored twice', () => {
  const { toSave, counts } = ingest([fromTcx()], { existing: [synced()], shoes });
  assert.deepEqual(toSave, []);
  assert.equal(counts.duplicates, 1);
  assert.equal(importToast(counts, 1).message, '2 duplicaat');
});

test('a TCX off by the UTC offset is a different run, not the same one', () => {
  // The <Id> read as if it were local time: two hours early as an instant.
  const { toSave } = ingest([fromTcx('2000-06-01T08:00:00.000Z')], { existing: [synced()], shoes });
  assert.equal(toSave.length, 1);
});

test('order does not matter: the synced run arriving after its import is not stored again', () => {
  for (const imported of [fromJsonExport(), fromTcx()]) {
    const stored = { ...imported, shoeId: 1 };
    const { toSave, updatedExisting, counts } = ingest([stored, synced()], { existing: [stored], shoes });
    assert.deepEqual(toSave, []);
    assert.deepEqual(updatedExisting, []);
    assert.equal(counts.duplicates, 1);
  }
});

test('both copies in one batch: the synced one is kept, whichever comes first', () => {
  for (const batch of [[fromJsonExport(), synced()], [synced(), fromTcx()]]) {
    const { toSave, counts } = ingest(batch, { existing: [], shoes });
    assert.deepEqual(toSave.map((e) => e.id), ['1234567']);
    assert.equal(counts.duplicates, 1);
  }
});

test('re-syncing after such an import changes nothing', () => {
  // The server exercise cache holds both the import and the Polar copy.
  const serverCache = [synced(), fromJsonExport(), fromTcx()];
  const first = ingest(serverCache, { existing: [], shoes });
  assert.equal(first.toSave.length, 1);

  const existing = first.toSave;
  for (let i = 0; i < 2; i++) {
    const again = ingest(serverCache, { existing, shoes });
    assert.deepEqual(again.toSave, []);
    assert.deepEqual(again.updatedExisting, []);
    assert.equal(again.counts.newExercises, 0);
    assert.equal(again.counts.total, 1);
  }
});

test('two distinct runs on the same day are both kept', () => {
  const stored = synced();
  const later = fromJsonExport('2000-06-01T18:00:00.000');
  const shorter = fromTcx(UTC_START, 1500);
  const { toSave } = ingest([later, shorter], { existing: [stored], shoes });
  assert.equal(toSave.length, 2);
  assert.equal(sameExercise(stored, later), false);
  assert.equal(sameExercise(stored, shorter), false);
});

test('two Polar-synced exercises with different ids are never the same exercise', () => {
  assert.equal(sameExercise(synced(), synced({ id: '7654321' })), false);
});

test('a Beat and a Pacer recording of one run stay overlap, not identity', () => {
  const pacer = synced();
  const beat = synced({ id: '999', device: 'Polar Beat', duration: 'PT30M10S' });
  const { toSave, counts } = ingest([beat, pacer], { existing: [], shoes });
  assert.equal(toSave.length, 2);
  assert.equal(toSave.find((e) => e.id === '999')?.overlap, true);
  assert.deepEqual({ overlaps: counts.overlaps, duplicates: counts.duplicates }, { overlaps: 1, duplicates: 0 });

  // An imported Beat recording against the stored Pacer one: also overlap.
  const importedBeat = { ...fromJsonExport(), device: 'Polar Beat' };
  const fromImport = ingest([importedBeat], { existing: [pacer], shoes });
  assert.equal(fromImport.toSave.length, 1);
  assert.equal(fromImport.toSave[0].overlap, true);
});
