import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** @typedef {import('../types/domain.ts').Exercise} Exercise */

/** @type {string} */
let dir;
/** @type {typeof import('../src/services/exerciseCache.ts')} */
let cache;

// Only the id matters to the cache
/** @type {(id: string) => Exercise} */
const exercise = (id) => ({ id, 'start-time': '2000-01-01T08:00:00.000', duration: 'PT30M', 'detailed-sport-info': 'RUNNING' });

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sports-tracker-'));
  process.env.SPORTS_DATA_DIR = dir;
  // Imported only now, so the store resolves its path from the temp directory
  cache = await import('../src/services/exerciseCache.ts');
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('appendToCache skips exercises already cached', async () => {
  assert.deepEqual(await cache.readCache(), []);

  assert.equal(await cache.appendToCache([exercise('1'), exercise('2')]), 2);
  assert.equal(await cache.appendToCache([exercise('2'), exercise('3')]), 1);
  assert.equal(await cache.appendToCache([]), 0);

  assert.deepEqual((await cache.readCache()).map((e) => e.id), ['1', '2', '3']);
  const onDisk = JSON.parse(await readFile(join(dir, 'exercises.json'), 'utf-8'));
  assert.equal(onDisk.length, 3);
});

test('removeFromCache remembers the deleted id', async () => {
  assert.equal(await cache.removeFromCache('2'), true);
  assert.equal(await cache.removeFromCache('2'), false);

  assert.deepEqual((await cache.readCache()).map((e) => e.id), ['1', '3']);
  assert.deepEqual([...(await cache.readDeletedIds())], ['2']);
});
