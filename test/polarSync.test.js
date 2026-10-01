import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
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
});

const LIST = 'https://polar.test/transactions/7';
/** @type {(id: string) => string} */
const exerciseUrl = (id) => `${LIST}/exercises/${id}`;

/** @type {(id: string) => Exercise} */
const exercise = (id) => ({
  id, 'start-time': '2000-01-01T08:00:00.000', duration: 'PT30M', 'detailed-sport-info': 'RUNNING', 'has-route': false,
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
    if (url === LIST) return method === 'PUT' ? new Response(null) : Response.json({ exercises: transaction.map((e) => exerciseUrl(e.id)) });
    for (const e of transaction) {
      if (url === exerciseUrl(e.id)) return Response.json(e);
      if (url === `${exerciseUrl(e.id)}/tcx`) return new Response(`<tcx id="${e.id}"/>`);
    }
    throw new Error(`Polar API error: 404 ${url}`);
  };
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
