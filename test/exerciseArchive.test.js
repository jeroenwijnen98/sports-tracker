import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

/** @typedef {import('../types/domain.ts').Exercise} Exercise */

/** @type {string} */
let dir;
/** @type {typeof import('../src/services/exerciseArchive.ts')} */
let archive;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sports-tracker-'));
  process.env.SPORTS_DATA_DIR = dir;
  // Imported only now, so the archive resolves its paths from the temp directory
  archive = await import('../src/services/exerciseArchive.ts');
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const file of ['exercises.json', 'deletedExercises.json', 'hrSensor.json']) {
    await rm(join(dir, file), { force: true });
  }
  await rm(join(dir, 'tcx'), { recursive: true, force: true });
  await rm(join(dir, 'gpx'), { recursive: true, force: true });
});

/** @type {(id: string) => Exercise} */
const exercise = (id) => ({ id, 'start-time': '2000-01-01T08:00:00.000', duration: 'PT30M', 'detailed-sport-info': 'RUNNING' });

/** @type {(name: string) => string} */
const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf-8');

async function storedIds() {
  return (await archive.list()).map((e) => e.id);
}

for (const source of /** @type {const} */ (['transaction', 'training-api'])) {
  test(`a deleted exercise is skipped for the ${source}`, async () => {
    await writeFile(join(dir, 'deletedExercises.json'), JSON.stringify(['1']));

    assert.equal(await archive.addExercises([exercise('1'), exercise('2')], { source }), 1);
    assert.deepEqual(await storedIds(), ['2']);
  });
}

test('a deleted exercise is still added for an import', async () => {
  await writeFile(join(dir, 'deletedExercises.json'), JSON.stringify(['1']));

  assert.equal(await archive.addExercises([exercise('1')], { source: 'import' }), 1);
  assert.deepEqual(await storedIds(), ['1']);
});

test('an exercise already stored is not added again', async () => {
  await archive.addExercises([exercise('1')], { source: 'import' });

  assert.equal(await archive.addExercises([exercise('1'), exercise('2')], { source: 'training-api' }), 1);
  assert.deepEqual(await storedIds(), ['1', '2']);
});

test('a removed exercise is recorded as deleted, a reverted one is not', async () => {
  await archive.addExercises([exercise('1'), exercise('2')], { source: 'import' });
  assert.equal(await archive.remove('1'), true);
  await archive.revert('2');
  assert.deepEqual(await storedIds(), []);

  await archive.addExercises([exercise('1'), exercise('2')], { source: 'transaction' });
  assert.deepEqual(await storedIds(), ['2']);
});

test('list() and find() carry each heart rate sensor exactly once', async () => {
  await archive.addExercises([exercise('1'), exercise('2')], { source: 'import' });
  const sensor = await archive.writeXml('tcx', '1', fixture('hr-strap.tcx'));
  assert.equal(sensor?.label, 'chest-strap');

  const listed = await archive.list();
  assert.deepEqual(listed.map((e) => e.hrSensor), [sensor, undefined]);
  assert.deepEqual(await archive.find('1'), listed[0]);
  assert.deepEqual(await archive.find('2'), listed[1]);
  assert.equal(await archive.find('3'), undefined);

  // Stored as it came in: the sensor is joined on reading, never written into the exercise
  const stored = JSON.parse(await readFile(join(dir, 'exercises.json'), 'utf-8'));
  assert.ok(stored.every((/** @type {Exercise} */ e) => !('hrSensor' in e)));
});

test('writeXml classifies a TCX only, and readXml reads back what it wrote', async () => {
  assert.equal(await archive.writeXml('gpx', '1', '<gpx/>'), null);
  assert.equal(await archive.readXml('gpx', '1'), '<gpx/>');
  assert.equal(await archive.readXml('tcx', '1'), null);
  // Too little heart rate data to classify: the XML is kept all the same
  assert.equal(await archive.writeXml('tcx', '2', fixture('hr-short.tcx')), null);
  assert.equal(await archive.readXml('tcx', '2'), fixture('hr-short.tcx'));
});

for (const file of ['exercises.json', 'deletedExercises.json']) {
  test(`verify() throws on an unreadable ${file} and leaves it untouched`, async () => {
    await writeFile(join(dir, file), '[{"id": "1"');

    await assert.rejects(archive.verify(), archive.CorruptCacheError);
    assert.equal(await readFile(join(dir, file), 'utf-8'), '[{"id": "1"');
  });
}

test('a missing heart rate sensor map reads as empty', async () => {
  await archive.addExercises([exercise('1')], { source: 'import' });

  assert.deepEqual(await archive.list(), [exercise('1')]);
  assert.equal(await archive.writeXml('tcx', '1', fixture('hr-strap.tcx')).then((s) => s?.label), 'chest-strap');
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(dir, 'hrSensor.json'), 'utf-8'))), ['1']);
});

for (const [kind, contents] of [['truncated', '{"1": {"label": "wr'], ['not an object', '[]']]) {
  test(`a ${kind} heart rate sensor map is left untouched and the TCX is still written`, async () => {
    await writeFile(join(dir, 'hrSensor.json'), contents);
    await archive.addExercises([exercise('1')], { source: 'import' });

    assert.equal(await archive.writeXml('tcx', '1', fixture('hr-strap.tcx')), null);
    assert.equal(await archive.readXml('tcx', '1'), fixture('hr-strap.tcx'));
    assert.equal(await readFile(join(dir, 'hrSensor.json'), 'utf-8'), contents);
    // The exercises still go out, only without a heart rate sensor
    assert.deepEqual(await archive.list(), [exercise('1')]);
  });
}

test('concurrent heart rate sensor recordings all end up in the map', async () => {
  const ids = Array.from({ length: 20 }, (_, i) => `s${i}`);
  const tcx = (/** @type {number} */ i) => fixture(i % 2 ? 'hr-wrist.tcx' : 'hr-strap.tcx');

  const sensors = await Promise.all(ids.map((id, i) => archive.writeXml('tcx', id, tcx(i))));

  assert.ok(sensors.every((s) => s !== null));
  const map = JSON.parse(await readFile(join(dir, 'hrSensor.json'), 'utf-8'));
  assert.deepEqual(Object.keys(map).sort(), [...ids].sort());
  assert.deepEqual(ids.map((id) => map[id].label), ids.map((_, i) => (i % 2 ? 'wrist' : 'chest-strap')));
});

test('the map, TCX and GPX are written through a temporary file that is gone afterwards', async () => {
  await archive.writeXml('tcx', '1', fixture('hr-strap.tcx'));
  await archive.writeXml('tcx', '1', fixture('hr-wrist.tcx'));
  await archive.writeXml('gpx', '1', '<gpx/>');

  assert.deepEqual((await readdir(dir)).sort(), ['gpx', 'hrSensor.json', 'tcx']);
  assert.deepEqual(await readdir(join(dir, 'tcx')), ['1.xml']);
  assert.deepEqual(await readdir(join(dir, 'gpx')), ['1.xml']);
  assert.equal(await archive.readXml('tcx', '1'), fixture('hr-wrist.tcx'));
});

test('the classify script waits for the heart rate sensor lock, then rebuilds the map', async () => {
  await archive.writeXml('tcx', '1', fixture('hr-strap.tcx'));
  await writeFile(join(dir, 'hrSensor.json'), 'not json');
  // The test runner that started this file: a process that is running
  await writeFile(join(dir, 'hrSensor.lock'), `${process.ppid} other`);

  const script = fileURLToPath(new URL('../scripts/classify-sensors.ts', import.meta.url));
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, SPORTS_DATA_DIR: dir },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(await readFile(join(dir, 'hrSensor.json'), 'utf-8'), 'not json');

  await rm(join(dir, 'hrSensor.lock'));
  assert.equal(await exited, 0);
  const map = JSON.parse(await readFile(join(dir, 'hrSensor.json'), 'utf-8'));
  assert.equal(map['1'].label, 'chest-strap');
});
