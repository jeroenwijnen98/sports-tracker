import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { polarJsonToTcx } from '../src/services/importConverters.ts';

/** @typedef {import('../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../types/domain.ts').HeartRateSensor} HeartRateSensor */
/** @typedef {import('../src/services/importExercise.ts').ImportStore} ImportStore */
/** @typedef {import('../src/services/importConverters.ts').ExportSession} ExportSession */

/** @type {string} */
let dir;
/** @type {typeof import('../src/services/importExercise.ts')} */
let service;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sports-tracker-'));
  process.env.SPORTS_DATA_DIR = dir;
  // Imported only now, so the real store resolves its paths from the temp directory
  service = await import('../src/services/importExercise.ts');
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** @type {(name: string) => string} */
const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf-8');

/** @type {HeartRateSensor} */
const STRAP = { label: 'chest-strap', smoothness: -2, confidence: 'moderate' };

// A synthetic Polar data export session with no route
/** @type {ExportSession} */
const SESSION = {
  exercises: [{ sport: 'RUNNING', startTime: '2000-01-01T08:00:00.000', duration: 'PT1200S', distance: 4000 }],
};

/**
 * An in-memory store that appends each write to `log`. A method named in
 * `failing` throws, as a failed disk write would.
 * @param {{ log: string[], stored?: Exercise[], sensor?: HeartRateSensor | null, failing?: string[] }} options
 * @returns {ImportStore & { exercises: Map<string, Exercise>, tcx: Map<string, string> }}
 */
function memoryStore({ log, stored = [], sensor = null, failing = [] }) {
  const exercises = new Map(stored.map((e) => [e.id, e]));
  /** @type {Map<string, string>} */
  const tcx = new Map();
  /** @type {(name: string) => void} */
  const maybeFail = (name) => { if (failing.includes(name)) throw new Error(`${name} failed`); };
  return {
    exercises,
    tcx,
    async findExercise(id) { return exercises.get(id); },
    async saveExercise(e) { log.push(`save ${e.id}`); maybeFail('saveExercise'); exercises.set(e.id, e); },
    async removeExercise(id) { log.push(`remove ${id}`); exercises.delete(id); },
    async writeTcx(id, xml) { log.push(`write tcx ${id}`); maybeFail('writeTcx'); tcx.set(id, xml); return sensor; },
  };
}

test('a TCX is imported with the heart rate sensor classified from it', async () => {
  /** @type {string[]} */
  const log = [];
  const xml = fixture('hr-strap.tcx');
  const store = memoryStore({ log, sensor: STRAP });
  const result = await service.importExercise({ kind: 'tcx', xml }, store);

  assert.equal(result.status, 'imported');
  assert.match(result.exercise.id, /^import-/);
  assert.equal(result.exercise.source, 'tcx-import');
  assert.deepEqual(result.exercise.hrSensor, STRAP);
  assert.deepEqual(log, [`save ${result.exercise.id}`, `write tcx ${result.exercise.id}`]);
  assert.equal(store.tcx.get(result.exercise.id), xml);
});

test('a JSON session is imported with its converted TCX', async () => {
  /** @type {string[]} */
  const log = [];
  const store = memoryStore({ log });
  const result = await service.importExercise({ kind: 'json', session: SESSION }, store);

  assert.equal(result.status, 'imported');
  assert.equal(result.exercise['start-time'], '2000-01-01T08:00:00.000');
  // No sensor could be classified, so none is attached
  assert.equal('hrSensor' in result.exercise, false);
  assert.match(store.tcx.get(result.exercise.id) ?? '', /<TrainingCenterDatabase/);
});

test('a duplicate id returns the stored exercise and writes nothing, from either source', async () => {
  const first = await service.importExercise({ kind: 'json', session: SESSION }, memoryStore({ log: [] }));
  const stored = { ...first.exercise, hrSensor: STRAP };

  // The TCX of the same run gets the same id as its JSON
  /** @type {import('../src/services/importExercise.ts').ImportSource[]} */
  const sources = [{ kind: 'json', session: SESSION }, { kind: 'tcx', xml: polarJsonToTcx(SESSION) }];
  for (const source of sources) {
    /** @type {string[]} */
    const log = [];
    const result = await service.importExercise(source, memoryStore({ log, stored: [stored] }));
    assert.deepEqual(result, { status: 'duplicate', exercise: stored });
    assert.deepEqual(log, []);
  }
});

test('a failed exercise write leaves no TCX behind', async () => {
  /** @type {string[]} */
  const log = [];
  const store = memoryStore({ log, sensor: STRAP, failing: ['saveExercise'] });
  await assert.rejects(service.importExercise({ kind: 'tcx', xml: fixture('hr-strap.tcx') }, store), /saveExercise failed/);

  assert.equal(store.tcx.size, 0);
  assert.equal(store.exercises.size, 0);
  assert.ok(!log.some((l) => l.startsWith('write')));
});

test('a failed TCX write takes the exercise back out', async () => {
  /** @type {string[]} */
  const log = [];
  const store = memoryStore({ log, failing: ['writeTcx'] });
  await assert.rejects(service.importExercise({ kind: 'json', session: SESSION }, store), /writeTcx failed/);

  assert.equal(store.exercises.size, 0);
  assert.match(log.at(-1) ?? '', /^remove import-/);
});

test('the disk store writes the exercise, the TCX and the sensor, and finds a duplicate', async () => {
  const xml = fixture('hr-strap.tcx');
  const result = await service.importExercise({ kind: 'tcx', xml }, service.diskImportStore);
  const { id } = result.exercise;

  assert.equal(result.status, 'imported');
  assert.equal(result.exercise.hrSensor?.label, 'chest-strap');
  const cached = JSON.parse(await readFile(join(dir, 'exercises.json'), 'utf-8'));
  assert.deepEqual(cached.map((/** @type {Exercise} */ e) => e.id), [id]);
  assert.equal(await readFile(join(dir, 'tcx', `${id}.xml`), 'utf-8'), xml);
  const sensors = JSON.parse(await readFile(join(dir, 'hrSensor.json'), 'utf-8'));
  assert.equal(sensors[id].label, 'chest-strap');

  // Imported again: the stored exercise, with its sensor, and nothing new on disk
  const again = await service.importExercise({ kind: 'tcx', xml }, service.diskImportStore);
  assert.equal(again.status, 'duplicate');
  // Compared as JSON, which is what the cache keeps: the undefined fields are gone
  assert.deepEqual(again.exercise, JSON.parse(JSON.stringify(result.exercise)));
  assert.deepEqual(await readdir(join(dir, 'tcx')), [`${id}.xml`]);
});
