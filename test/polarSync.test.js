import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** @typedef {import('../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../src/services/transactionConsumer.ts').PolarRequest} PolarRequest */

/** @type {string} */
let dir;
/** @type {typeof import('../src/services/polarSync.ts')} */
let sync;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sports-tracker-'));
  process.env.SPORTS_DATA_DIR = dir;
  // Imported only now, so the caches resolve their paths from the temp directory
  sync = await import('../src/services/polarSync.ts');
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(join(dir, 'exercises.json'), { force: true });
  await rm(join(dir, 'deletedExercises.json'), { force: true });
  await rm(join(dir, 'tcx'), { recursive: true, force: true });
  await rm(join(dir, 'gpx'), { recursive: true, force: true });
});

const LIST = 'https://polar.test/transactions/7';
/** @type {(id: string) => string} */
const exerciseUrl = (id) => `${LIST}/exercises/${id}`;

/** @type {(id: string, hasRoute?: boolean) => Exercise} */
const exercise = (id, hasRoute = false) => ({
  id, 'start-time': '2000-01-01T08:00:00.000', duration: 'PT30M', 'detailed-sport-info': 'RUNNING', 'has-route': hasRoute,
});

/**
 * A fake AccessLink with one transaction holding `transaction` and the
 * Training Data API serving `trainingApi`. A URL in `failing` throws.
 * @param {{ transaction?: Exercise[], trainingApi?: Exercise[], failing?: string[], log: string[] }} options
 * @returns {PolarRequest}
 */
function fakePolar({ transaction = [], trainingApi = [], failing = [], log }) {
  return async (url, { method = 'GET' } = {}) => {
    log.push(`${method} ${url}`);
    if (failing.includes(url)) throw new Error('Polar API error: 500');
    if (method === 'POST') return Response.json({ 'resource-uri': LIST }, { status: 201 });
    if (url === '/exercises') return Response.json(trainingApi);
    for (const e of trainingApi) {
      if (url === `/exercises/${e.id}/tcx`) return new Response(`<tcx id="${e.id}"/>`);
      if (url === `/exercises/${e.id}/gpx` && e['has-route']) return new Response(`<gpx id="${e.id}"/>`);
    }
    if (url === LIST) return method === 'PUT' ? new Response(null) : Response.json({ exercises: transaction.map((e) => exerciseUrl(e.id)) });
    for (const e of transaction) {
      if (url === exerciseUrl(e.id)) return Response.json(e);
      if (url === `${exerciseUrl(e.id)}/tcx`) return new Response(`<tcx id="${e.id}"/>`);
    }
    throw new Error(`Polar API error: 404 ${url}`);
  };
}

/** @type {(type: string, id: string) => Promise<string | null>} */
async function cachedXml(type, id) {
  return readFile(join(dir, type, `${id}.xml`), 'utf-8').catch(() => null);
}

async function cachedIds() {
  return JSON.parse(await readFile(join(dir, 'exercises.json'), 'utf-8')).map((/** @type {Exercise} */ e) => e.id);
}

test('both sources reach the cache and the transaction is committed', async () => {
  /** @type {string[]} */
  const log = [];
  const result = await sync.syncFromPolar({
    request: fakePolar({ transaction: [exercise('1')], trainingApi: [exercise('1'), exercise('2')], log }),
    userId: 42,
  });

  assert.deepEqual(result, { fromTransaction: 1, fromTrainingApi: 2, added: 2, failed: [] });
  assert.deepEqual(await cachedIds(), ['1', '2']);
  assert.ok(log.includes(`PUT ${LIST}`));
});

test('a failed TCX fetch is reported and the transaction is left open', async () => {
  /** @type {string[]} */
  const log = [];
  const result = await sync.syncFromPolar({
    request: fakePolar({ transaction: [exercise('3')], failing: [`${exerciseUrl('3')}/tcx`], log }),
    userId: 42,
  });

  assert.deepEqual(result.failed, [`${exerciseUrl('3')}/tcx`]);
  assert.equal(result.fromTransaction, 0);
  // The exercise JSON is stored all the same
  assert.equal(result.added, 1);
  assert.deepEqual(await cachedIds(), ['3']);
  assert.ok(!log.some((l) => l.startsWith('PUT')));
});

test('a deleted exercise is skipped from both sources', async () => {
  await writeFile(join(dir, 'deletedExercises.json'), JSON.stringify(['4', '5']));
  /** @type {string[]} */
  const log = [];
  const result = await sync.syncFromPolar({
    request: fakePolar({ transaction: [exercise('4'), exercise('6')], trainingApi: [exercise('5'), exercise('7')], log }),
    userId: 42,
  });

  assert.deepEqual(result.failed, []);
  assert.equal(result.added, 2);
  assert.deepEqual(await cachedIds(), ['6', '7']);
  assert.ok(!log.some((l) => l.includes('/exercises/5')));
  assert.equal(await cachedXml('tcx', '5'), null);
});

test('a failing Training Data API is only logged', async () => {
  /** @type {string[]} */
  const log = [];
  const result = await sync.syncFromPolar({
    request: fakePolar({ transaction: [exercise('8')], failing: ['/exercises'], log }),
    userId: 42,
  });

  assert.deepEqual(result, { fromTransaction: 1, fromTrainingApi: 0, added: 1, failed: [] });
});

test('a Training Data API exercise is synced with its TCX, and its GPX when it has a route', async () => {
  /** @type {string[]} */
  const log = [];
  const result = await sync.syncFromPolar({
    request: fakePolar({ trainingApi: [exercise('10', true), exercise('11')], log }),
    userId: 42,
  });

  assert.deepEqual(result.failed, []);
  assert.equal(await cachedXml('tcx', '10'), '<tcx id="10"/>');
  assert.equal(await cachedXml('gpx', '10'), '<gpx id="10"/>');
  assert.equal(await cachedXml('tcx', '11'), '<tcx id="11"/>');
  assert.equal(await cachedXml('gpx', '11'), null);
  assert.ok(!log.includes('GET /exercises/11/gpx'));
});

test('a failed top-up fetch is reported, and the sync goes on and still commits', async () => {
  /** @type {string[]} */
  const log = [];
  const result = await sync.syncFromPolar({
    request: fakePolar({
      transaction: [exercise('12')],
      trainingApi: [exercise('13', true), exercise('14')],
      failing: ['/exercises/13/tcx'],
      log,
    }),
    userId: 42,
  });

  assert.deepEqual(result.failed, ['/exercises/13/tcx']);
  assert.equal(result.fromTransaction, 1);
  // The exercise JSON is stored all the same, and so is what did arrive
  assert.deepEqual(await cachedIds(), ['12', '13', '14']);
  assert.equal(await cachedXml('gpx', '13'), '<gpx id="13"/>');
  assert.equal(await cachedXml('tcx', '14'), '<tcx id="14"/>');
  assert.ok(log.includes(`PUT ${LIST}`));
});

test('XML already cached is not fetched again', async () => {
  await mkdir(join(dir, 'tcx'), { recursive: true });
  await writeFile(join(dir, 'tcx', '15.xml'), '<tcx kept/>');
  /** @type {string[]} */
  const log = [];
  const result = await sync.syncFromPolar({
    request: fakePolar({ trainingApi: [exercise('15', true)], log }),
    userId: 42,
  });

  assert.deepEqual(result.failed, []);
  assert.ok(!log.includes('GET /exercises/15/tcx'));
  assert.ok(log.includes('GET /exercises/15/gpx'));
  assert.equal(await cachedXml('tcx', '15'), '<tcx kept/>');
});

test('an exercise the transaction secured is not fetched again by the top-up', async () => {
  /** @type {string[]} */
  const log = [];
  await sync.syncFromPolar({
    request: fakePolar({ transaction: [exercise('16')], trainingApi: [exercise('16')], log }),
    userId: 42,
  });

  assert.ok(!log.some((l) => l.startsWith('GET /exercises/16')));
});

/** @type {(exercises: Exercise[]) => Promise<void>} */
async function cache(exercises) {
  await writeFile(join(dir, 'exercises.json'), JSON.stringify(exercises));
}

test('a cached exercise without XML on disk is backfilled while the Training Data API lists it', async () => {
  await cache([exercise('20', true), exercise('21')]);
  /** @type {string[]} */
  const log = [];
  const result = await sync.syncFromPolar({
    request: fakePolar({ trainingApi: [exercise('20', true), exercise('21')], log }),
    userId: 42,
  });

  assert.deepEqual(result.failed, []);
  assert.equal(result.added, 0);
  assert.equal(await cachedXml('tcx', '20'), '<tcx id="20"/>');
  assert.equal(await cachedXml('gpx', '20'), '<gpx id="20"/>');
  assert.equal(await cachedXml('tcx', '21'), '<tcx id="21"/>');
  assert.ok(!log.includes('GET /exercises/21/gpx'));
});

test('a cached exercise the Training Data API no longer lists is not fetched', async () => {
  await cache([exercise('22', true)]);
  /** @type {string[]} */
  const log = [];
  const result = await sync.syncFromPolar({
    request: fakePolar({ trainingApi: [], log }),
    userId: 42,
  });

  assert.deepEqual(result.failed, []);
  assert.ok(!log.some((l) => l.includes('/exercises/22')));
});

test('a cached exercise with its XML on disk is not fetched again, a deleted one not at all', async () => {
  await cache([exercise('23', true)]);
  await mkdir(join(dir, 'tcx'), { recursive: true });
  await mkdir(join(dir, 'gpx'), { recursive: true });
  await writeFile(join(dir, 'tcx', '23.xml'), '<tcx kept/>');
  await writeFile(join(dir, 'gpx', '23.xml'), '<gpx kept/>');
  // Deleting an exercise removes it from the cache and records its id
  await writeFile(join(dir, 'deletedExercises.json'), JSON.stringify(['24']));
  /** @type {string[]} */
  const log = [];
  const result = await sync.syncFromPolar({
    request: fakePolar({ trainingApi: [exercise('23', true), exercise('24', true)], log }),
    userId: 42,
  });

  assert.deepEqual(result.failed, []);
  assert.ok(!log.some((l) => l.includes('/exercises/23') || l.includes('/exercises/24')));
  assert.equal(await cachedXml('tcx', '23'), '<tcx kept/>');
  assert.equal(await cachedXml('tcx', '24'), null);
});

test('a failed backfill fetch is reported and the sync goes on', async () => {
  await cache([exercise('25'), exercise('26')]);
  /** @type {string[]} */
  const log = [];
  const result = await sync.syncFromPolar({
    request: fakePolar({
      transaction: [exercise('27')],
      trainingApi: [exercise('25'), exercise('26')],
      failing: ['/exercises/25/tcx'],
      log,
    }),
    userId: 42,
  });

  assert.deepEqual(result.failed, ['/exercises/25/tcx']);
  assert.equal(await cachedXml('tcx', '26'), '<tcx id="26"/>');
  assert.equal(result.fromTransaction, 1);
  assert.ok(log.includes(`PUT ${LIST}`));
});

for (const file of ['exercises.json', 'deletedExercises.json']) {
  test(`an unreadable ${file} fails the sync before a transaction is opened`, async () => {
    await writeFile(join(dir, file), '[{"id": "1"');
    /** @type {string[]} */
    const log = [];

    await assert.rejects(
      sync.syncFromPolar({ request: fakePolar({ transaction: [exercise('2')], trainingApi: [exercise('3')], log }), userId: 42 }),
      { name: 'CorruptCacheError' },
    );
    assert.deepEqual(log, []);
    assert.equal(await readFile(join(dir, file), 'utf-8'), '[{"id": "1"');
  });
}
