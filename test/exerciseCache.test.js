import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir;
let cache;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sports-tracker-'));
  process.env.SPORTS_DATA_DIR = dir;
  // Imported only now, so the store resolves its path from the temp directory
  cache = await import('../src/services/exerciseCache.js');
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('appendToCache skips exercises already cached', async () => {
  assert.deepEqual(await cache.readCache(), []);

  assert.equal(await cache.appendToCache([{ id: 1 }, { id: 2 }]), 2);
  assert.equal(await cache.appendToCache([{ id: 2 }, { id: 3 }]), 1);
  assert.equal(await cache.appendToCache([]), 0);

  assert.deepEqual((await cache.readCache()).map((e) => e.id), [1, 2, 3]);
  const onDisk = JSON.parse(await readFile(join(dir, 'exercises.json'), 'utf-8'));
  assert.equal(onDisk.length, 3);
});

test('removeFromCache remembers the deleted id', async () => {
  assert.equal(await cache.removeFromCache('2'), true);
  assert.equal(await cache.removeFromCache('2'), false);

  assert.deepEqual((await cache.readCache()).map((e) => e.id), [1, 3]);
  assert.deepEqual([...(await cache.readDeletedIds())], ['2']);
});
