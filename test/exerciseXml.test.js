import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** @typedef {import('../src/services/transactionConsumer.ts').PolarRequest} PolarRequest */

/** @type {string} */
let dir;
/** @type {typeof import('../src/services/exerciseXml.ts')} */
let exerciseXml;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sports-tracker-'));
  process.env.SPORTS_DATA_DIR = dir;
  // Imported only now, so the XML cache resolves its path from the temp directory
  exerciseXml = await import('../src/services/exerciseXml.ts');
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(join(dir, 'tcx'), { recursive: true, force: true });
  await rm(join(dir, 'gpx'), { recursive: true, force: true });
});

/**
 * A fake Training Data API serving `xml` for every path, or throwing like
 * `polarRequest` on a non-2xx status when `xml` is null.
 * @param {string | null} xml
 * @param {{ url: string, accept?: string }[]} log
 * @returns {PolarRequest}
 */
function fakeTrainingApi(xml, log) {
  return async (url, { accept } = {}) => {
    log.push({ url, accept });
    if (xml === null) throw new Error('Polar API error: 404');
    return new Response(xml);
  };
}

test('cached XML is served without calling the fetcher', async () => {
  await mkdir(join(dir, 'gpx'), { recursive: true });
  await writeFile(join(dir, 'gpx', '1.xml'), '<gpx cached/>');
  /** @type {{ url: string, accept?: string }[]} */
  const log = [];

  const answer = await exerciseXml.readExerciseXml(fakeTrainingApi('<gpx fresh/>', log), 'gpx', '1');

  assert.deepEqual(answer, { status: 'found', xml: '<gpx cached/>' });
  assert.deepEqual(log, []);
});

test('on a cache miss the Training Data API answer is served and cached', async () => {
  /** @type {{ url: string, accept?: string }[]} */
  const log = [];
  const request = fakeTrainingApi('<gpx fresh/>', log);

  const answer = await exerciseXml.readExerciseXml(request, 'gpx', '2');

  assert.deepEqual(answer, { status: 'found', xml: '<gpx fresh/>' });
  assert.deepEqual(log, [{ url: '/exercises/2/gpx', accept: 'application/gpx+xml' }]);
  assert.equal(await readFile(join(dir, 'gpx', '2.xml'), 'utf-8'), '<gpx fresh/>');

  // A later request is served from the cache
  const again = await exerciseXml.readExerciseXml(request, 'gpx', '2');
  assert.deepEqual(again, { status: 'found', xml: '<gpx fresh/>' });
  assert.equal(log.length, 1);
});

test('TCX from the Training Data API is asked for as TCX', async () => {
  /** @type {{ url: string, accept?: string }[]} */
  const log = [];

  const answer = await exerciseXml.readExerciseXml(fakeTrainingApi('<tcx/>', log), 'tcx', '3');

  assert.deepEqual(answer, { status: 'found', xml: '<tcx/>' });
  assert.deepEqual(log, [{ url: '/exercises/3/tcx', accept: 'application/vnd.garmin.tcx+xml' }]);
  assert.equal(await readFile(join(dir, 'tcx', '3.xml'), 'utf-8'), '<tcx/>');
});

test('when the Training Data API fails the XML is unavailable and nothing is cached', async () => {
  /** @type {{ url: string, accept?: string }[]} */
  const log = [];

  const answer = await exerciseXml.readExerciseXml(fakeTrainingApi(null, log), 'tcx', '4');

  assert.deepEqual(answer, { status: 'unavailable' });
  assert.equal(log.length, 1);
  await assert.rejects(readFile(join(dir, 'tcx', '4.xml'), 'utf-8'), { code: 'ENOENT' });
});

test('a type other than tcx or gpx is not XML and calls nothing', async () => {
  /** @type {{ url: string, accept?: string }[]} */
  const log = [];

  for (const type of ['fit', 'TCX', 'toString']) {
    const answer = await exerciseXml.readExerciseXml(fakeTrainingApi('<x/>', log), type, '5');
    assert.deepEqual(answer, { status: 'not-xml' });
  }
  assert.deepEqual(log, []);
});
