import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingest, createIntake } from '../public/js/intake.js';

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
  { id: 1, name: 'Oud', initialKm: 0, isDefault: false },
  { id: 2, name: 'Nieuw', initialKm: 0, isDefault: true },
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
  assert.deepEqual(counts, { newExercises: 2, overlaps: 1, duplicates: 0, total: 2 });
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
  assert.deepEqual(counts, { newExercises: 1, overlaps: 1, duplicates: 0, total: 2 });
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
  assert.deepEqual(again.counts, { newExercises: 0, overlaps: 0, duplicates: 0, total: 2 });
});

test('the default shoe goes to new exercises only, without mutating the input', () => {
  /** @type {Exercise} */
  const stored = {
    ...run('old', 'Polar Pacer', '06:00'),
    shoeId: 1,
    overlap: true,
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
  assert.deepEqual(counts, { newExercises: 0, overlaps: 0, duplicates: 0, total: 1 });

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

/**
 * An in-memory intake store whose reads and writes each take a tick, as
 * IndexedDB's do, so two intakes that are not serialised both read before
 * either writes.
 * @param {Exercise[]} [stored]
 */
function memoryStore(stored = []) {
  /** @type {Map<string, Exercise>} */
  const exercises = new Map(stored.map((e) => [e.id, e]));
  const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
  return {
    exercises,
    store: {
      exercises: async () => { await tick(); return [...exercises.values()]; },
      shoes: async () => { await tick(); return shoes; },
      /** @param {Exercise[]} items */
      putExercises: async (items) => { await tick(); for (const e of items) exercises.set(e.id, e); },
    },
  };
}

test('two intakes started together run one after the other: the second reads what the first stored', async () => {
  const { exercises, store } = memoryStore();
  const ingestAndSave = createIntake(store);

  const synced = run('polar-1', 'Polar Pacer', '08:00');
  /** @type {Exercise} */
  const imported = { ...run('import-1', 'Polar Pacer', '08:00'), source: 'tcx-import' };

  const [sync, fileImport] = await Promise.all([ingestAndSave([synced]), ingestAndSave([imported])]);

  assert.deepEqual([...exercises.keys()], ['polar-1'], 'the same exercise is stored once');
  assert.deepEqual(sync.newIds, ['polar-1']);
  assert.deepEqual(fileImport.newIds, []);
  assert.equal(fileImport.counts.duplicates, 1, 'and counted once as a duplicate');
  assert.equal(sync.counts.duplicates + fileImport.counts.duplicates, 1);
});

test('two intakes started together see each other for overlap', async () => {
  const { exercises, store } = memoryStore();
  const ingestAndSave = createIntake(store);

  await Promise.all([
    ingestAndSave([run('pacer', 'Polar Pacer', '08:00')]),
    ingestAndSave([{ ...run('beat', 'Polar Beat', '08:02'), source: 'tcx-import' }]),
  ]);

  assert.equal(exercises.get('beat')?.overlap, true);
  assert.equal(exercises.get('pacer')?.overlap, undefined);
});

test('a failed intake does not stop the next one', async () => {
  const { exercises, store } = memoryStore();
  let fail = true;
  const ingestAndSave = createIntake({
    ...store,
    putExercises: async (items) => {
      if (fail) { fail = false; throw new Error('write failed'); }
      await store.putExercises(items);
    },
  });

  const first = ingestAndSave([run('a', 'Polar Pacer', '08:00')]);
  const second = ingestAndSave([run('b', 'Polar Pacer', '10:00')]);

  await assert.rejects(first, /write failed/);
  assert.deepEqual((await second).newIds, ['b']);
  assert.deepEqual([...exercises.keys()], ['b']);
});
