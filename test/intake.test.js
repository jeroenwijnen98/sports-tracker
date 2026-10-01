import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingest } from '../public/js/intake.js';

/** @typedef {import('../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../types/domain.ts').Shoe} Shoe */

/** @type {(id: string, device: string | undefined, start: string, sport?: string) => Exercise} */
const run = (id, device, start, sport = 'RUNNING') => ({
  id,
  device,
  'start-time': `2000-01-01T${start}:00.000`,
  duration: 'PT30M',
  distance: 5000,
  'detailed-sport-info': sport,
});

/** @type {Shoe[]} */
const shoes = [
  { id: 1, name: 'Oud', initialKm: 0, totalKm: 0, isDefault: false },
  { id: 2, name: 'Nieuw', initialKm: 0, totalKm: 0, isDefault: true },
];

/** @type {(ex: Exercise[]) => string} */
const snapshot = (ex) => JSON.stringify(ex);

test('a Pacer and a Beat run in the same batch: the Beat run is saved as overlap', () => {
  const { toSave, updatedExisting, counts } = ingest(
    [run('beat', 'Polar Beat', '08:00'), run('pacer', 'Polar Pacer', '08:02')],
    { existing: [], shoes },
  );

  assert.equal(toSave.find((e) => e.id === 'beat')?.overlap, true);
  assert.equal(toSave.find((e) => e.id === 'pacer')?.overlap, undefined);
  assert.deepEqual(updatedExisting, []);
  assert.deepEqual(counts, { newExercises: 2, overlaps: 1, total: 2 });
});

test('a watch run arriving by sync marks the stored Beat recording as overlap', () => {
  const stored = { ...run('beat', 'Polar Beat', '08:00'), shoeId: 1 };
  const { toSave, updatedExisting, counts } = ingest(
    [stored, run('pacer', 'Polar Pacer', '08:01')],
    { existing: [stored], shoes },
  );

  assert.deepEqual(toSave.map((e) => e.id), ['pacer']);
  assert.deepEqual(updatedExisting, [{ ...stored, overlap: true }]);
  assert.equal(stored.overlap, undefined, 'the stored exercise is not mutated');
  assert.deepEqual(counts, { newExercises: 1, overlaps: 1, total: 2 });
});

test('only running sports get in', () => {
  const { toSave, counts } = ingest(
    [run('r', 'Polar Pacer', '08:00'), run('c', 'Polar Pacer', '10:00', 'CYCLING')],
    { existing: [], shoes },
  );
  assert.deepEqual(toSave.map((e) => e.id), ['r']);
  assert.equal(counts.newExercises, 1);
});

test('re-ingesting the same batch saves nothing and changes no counts', () => {
  const batch = [run('beat', 'Polar Beat', '08:00'), run('pacer', 'Polar Pacer', '08:02')];
  const first = ingest(batch, { existing: [], shoes });
  const existing = [...first.toSave, ...first.updatedExisting];

  const again = ingest(batch, { existing, shoes });
  assert.deepEqual(again.toSave, []);
  assert.deepEqual(again.updatedExisting, []);
  assert.deepEqual(again.counts, { newExercises: 0, overlaps: 0, total: 2 });
});

test('the default shoe goes to new exercises only, without mutating the input', () => {
  /** @type {Exercise} */
  const stored = {
    ...run('old', 'Polar Pacer', '06:00'),
    shoeId: 1,
    overlap: true,
    detailData: { unavailable: true, checkedAt: 1 },
  };
  const incomingStored = run('old', 'Polar Pacer', '06:00');
  const fresh = run('new', 'Polar Pacer', '08:00');
  const before = snapshot([incomingStored, fresh, stored]);

  const { toSave, updatedExisting } = ingest([incomingStored, fresh], { existing: [stored], shoes });

  assert.deepEqual(toSave.map((e) => [e.id, e.shoeId]), [['new', 2]]);
  assert.deepEqual(updatedExisting, []);
  assert.equal(snapshot([incomingStored, fresh, stored]), before);
});

test('a new exercise that already has a shoe keeps it', () => {
  const { toSave } = ingest([{ ...run('new', 'Polar Pacer', '08:00'), shoeId: 1 }], { existing: [], shoes });
  assert.equal(toSave[0].shoeId, 1);
});

test('without a default shoe new exercises stay unassigned', () => {
  const { toSave } = ingest([run('new', 'Polar Pacer', '08:00')], { existing: [], shoes: [] });
  assert.equal(toSave[0].shoeId, undefined);
});

test('a changed heart rate sensor is backfilled onto the stored exercise, nothing else', () => {
  /** @type {Exercise} */
  const stored = {
    ...run('old', 'Polar Pacer', '06:00'),
    shoeId: 1,
    overlap: true,
    detailData: { unavailable: true, checkedAt: 1 },
    hrSensor: { label: 'unknown', smoothness: 0.5 },
  };
  /** @type {Exercise} */
  const incoming = {
    ...run('old', 'Polar Pacer', '06:00'),
    distance: 9999,
    hrSensor: { label: 'wrist', smoothness: 1.2 },
  };

  const { toSave, updatedExisting, counts } = ingest([incoming], { existing: [stored], shoes });

  assert.deepEqual(toSave, []);
  assert.deepEqual(updatedExisting, [{ ...stored, hrSensor: incoming.hrSensor }]);
  assert.deepEqual(counts, { newExercises: 0, overlaps: 0, total: 1 });

  const unchanged = ingest([incoming], { existing: updatedExisting, shoes });
  assert.deepEqual(unchanged.updatedExisting, []);
});

test('a stored Beat run marked overlap and given a sensor in one sync is one update', () => {
  const stored = run('beat', 'Polar Beat', '08:00');
  /** @type {Exercise} */
  const incomingBeat = { ...stored, hrSensor: { label: 'wrist', smoothness: 1.1 } };

  const { updatedExisting } = ingest(
    [incomingBeat, run('pacer', 'Polar Pacer', '08:01')],
    { existing: [stored], shoes },
  );

  assert.deepEqual(updatedExisting, [{ ...stored, overlap: true, hrSensor: incomingBeat.hrSensor }]);
});
