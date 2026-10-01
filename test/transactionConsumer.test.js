import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** @typedef {import('../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../src/services/transactionConsumer.ts').TransactionStore} TransactionStore */
/** @typedef {import('../src/services/transactionConsumer.ts').PolarRequest} PolarRequest */

/** @type {string} */
let dir;
/** @type {typeof import('../src/services/transactionConsumer.ts')} */
let consumer;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sports-tracker-'));
  process.env.SPORTS_DATA_DIR = dir;
  // Imported only now, so the real store resolves its paths from the temp directory
  consumer = await import('../src/services/transactionConsumer.ts');
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const LIST = 'https://polar.test/transactions/7';
/** @type {(id: string) => string} */
const exerciseUrl = (id) => `${LIST}/exercises/${id}`;

/** @type {(id: string, hasRoute?: boolean) => Exercise} */
const exercise = (id, hasRoute = true) => ({
  id, 'start-time': '2000-01-01T08:00:00.000', duration: 'PT30M', 'detailed-sport-info': 'RUNNING', 'has-route': hasRoute,
});

/**
 * A fake AccessLink holding one transaction with `exercises`. Every request
 * is appended to `log` as `METHOD url`; a URL in `failing` throws, as
 * polarRequest does on a non-2xx status.
 * @param {{ exercises?: Exercise[], failing?: string[], empty?: boolean, log: string[] }} options
 * @returns {PolarRequest}
 */
function fakePolar({ exercises = [], failing = [], empty = false, log }) {
  return async (url, { method = 'GET' } = {}) => {
    log.push(`${method} ${url}`);
    if (failing.includes(url)) throw new Error('Polar API error: 500');
    if (method === 'POST') {
      return empty ? new Response(null, { status: 204 }) : Response.json({ 'resource-uri': LIST }, { status: 201 });
    }
    if (url === LIST) return method === 'PUT' ? new Response(null) : Response.json({ exercises: exercises.map((e) => exerciseUrl(e.id)) });
    for (const e of exercises) {
      if (url === exerciseUrl(e.id)) return Response.json(e);
      if (url === `${exerciseUrl(e.id)}/tcx`) return new Response(`<tcx id="${e.id}"/>`);
      if (url === `${exerciseUrl(e.id)}/gpx`) return new Response(`<gpx id="${e.id}"/>`);
    }
    throw new Error(`Polar API error: 404 ${url}`);
  };
}

/**
 * An in-memory store that appends each write to `log`.
 * @param {string[]} log
 * @param {string[]} [cachedXml] `type:id` keys already in the XML cache
 * @returns {TransactionStore}
 */
function memoryStore(log, cachedXml = []) {
  return {
    async saveExercise(e) { log.push(`save ${e.id}`); },
    async hasXml(type, id) { return cachedXml.includes(`${type}:${id}`); },
    async writeXml(type, id) { log.push(`write ${type} ${id}`); },
  };
}

test('exercise JSON and XML are written before the commit', async () => {
  /** @type {string[]} */
  const log = [];
  const result = await consumer.consumeTransaction({
    request: fakePolar({ exercises: [exercise('1'), exercise('2', false)], log }),
    store: memoryStore(log),
    userId: 42,
  });

  assert.deepEqual(result.secured.map((e) => e.id), ['1', '2']);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(log.filter((l) => !l.startsWith('GET')), [
    'POST /users/42/exercise-transactions',
    'save 1', 'write tcx 1', 'write gpx 1',
    'save 2', 'write tcx 2',
    `PUT ${LIST}`,
  ]);
});

test('XML already cached is not fetched again', async () => {
  /** @type {string[]} */
  const log = [];
  const result = await consumer.consumeTransaction({
    request: fakePolar({ exercises: [exercise('1')], log }),
    store: memoryStore(log, ['tcx:1']),
    userId: 42,
  });

  assert.deepEqual(result.failed, []);
  assert.ok(!log.includes(`GET ${exerciseUrl('1')}/tcx`));
  assert.ok(log.includes(`GET ${exerciseUrl('1')}/gpx`));
  assert.equal(log.at(-1), `PUT ${LIST}`);
});

test('a failed exercise fetch leaves the transaction open and is reported', async () => {
  /** @type {string[]} */
  const log = [];
  const result = await consumer.consumeTransaction({
    request: fakePolar({ exercises: [exercise('1'), exercise('2')], failing: [exerciseUrl('1')], log }),
    store: memoryStore(log),
    userId: 42,
  });

  assert.deepEqual(result.failed, [exerciseUrl('1')]);
  // The other exercise is still secured, but nothing is committed
  assert.deepEqual(result.secured.map((e) => e.id), ['2']);
  assert.ok(log.includes('save 2'));
  assert.ok(!log.some((l) => l.startsWith('PUT')));
});

for (const type of ['tcx', 'gpx']) {
  test(`a failed ${type.toUpperCase()} fetch leaves the transaction open and is reported`, async () => {
    /** @type {string[]} */
    const log = [];
    const failingUrl = `${exerciseUrl('1')}/${type}`;
    const result = await consumer.consumeTransaction({
      request: fakePolar({ exercises: [exercise('1')], failing: [failingUrl], log }),
      store: memoryStore(log),
      userId: 42,
    });

    assert.deepEqual(result.failed, [failingUrl]);
    assert.deepEqual(result.secured, []);
    // The exercise JSON is kept all the same
    assert.ok(log.includes('save 1'));
    assert.ok(!log.some((l) => l.startsWith('PUT')));
  });
}

test('a failed transaction list is reported and nothing is committed', async () => {
  /** @type {string[]} */
  const log = [];
  const result = await consumer.consumeTransaction({
    request: fakePolar({ exercises: [exercise('1')], failing: [LIST], log }),
    store: memoryStore(log),
    userId: 42,
  });

  assert.deepEqual(result, { secured: [], failed: [LIST] });
  assert.equal(log.length, 2);
});

test('a 204 on create returns nothing and sends no commit', async () => {
  /** @type {string[]} */
  const log = [];
  const result = await consumer.consumeTransaction({
    request: fakePolar({ empty: true, log }),
    store: memoryStore(log),
    userId: 42,
  });

  assert.deepEqual(result, { secured: [], failed: [] });
  assert.deepEqual(log, ['POST /users/42/exercise-transactions']);
});

test('the disk store skips a deleted exercise without blocking the commit', async () => {
  await writeFile(join(dir, 'deletedExercises.json'), JSON.stringify(['9']));
  /** @type {string[]} */
  const log = [];
  const result = await consumer.consumeTransaction({
    request: fakePolar({ exercises: [exercise('8'), exercise('9')], log }),
    store: consumer.diskStore,
    userId: 42,
  });

  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.secured.map((e) => e.id), ['8', '9']);
  assert.equal(log.at(-1), `PUT ${LIST}`);

  const cached = JSON.parse(await readFile(join(dir, 'exercises.json'), 'utf-8'));
  assert.deepEqual(cached.map((/** @type {Exercise} */ e) => e.id), ['8']);
  assert.equal(await readFile(join(dir, 'tcx', '8.xml'), 'utf-8'), '<tcx id="8"/>');
  assert.equal(await readFile(join(dir, 'gpx', '8.xml'), 'utf-8'), '<gpx id="8"/>');
});
