import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
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

test('every write goes through a temporary file that is gone afterwards', async () => {
  await cache.appendToCache([exercise('4')]);
  await cache.removeFromCache('4');
  await cache.revertAppend('3');

  assert.deepEqual((await readdir(dir)).sort(), ['deletedExercises.json', 'exercises.json']);
});

test('a missing cache or deleted-exercise list reads as empty', async () => {
  await rm(join(dir, 'exercises.json'));
  await rm(join(dir, 'deletedExercises.json'));

  assert.deepEqual(await cache.readCache(), []);
  assert.deepEqual([...(await cache.readDeletedIds())], []);
});

/**
 * Write `files` (name -> contents) into the data directory, run `act`, and
 * check every file still holds exactly what was written.
 * @param {Record<string, string>} files
 * @param {() => Promise<unknown>} act
 */
async function assertUntouched(files, act) {
  for (const [name, contents] of Object.entries(files)) await writeFile(join(dir, name), contents);
  await assert.rejects(act, cache.CorruptCacheError);
  for (const [name, contents] of Object.entries(files)) {
    assert.equal(await readFile(join(dir, name), 'utf-8'), contents);
  }
}

const valid = JSON.stringify([exercise('1')]);
const truncated = valid.slice(0, 40);

test('a truncated cache makes append, revert and remove throw and stays as it was', async () => {
  const files = { 'exercises.json': truncated, 'deletedExercises.json': '[]' };
  await assertUntouched(files, () => cache.readCache());
  await assertUntouched(files, () => cache.appendToCache([exercise('2')]));
  await assertUntouched(files, () => cache.revertAppend('1'));
  await assertUntouched(files, () => cache.removeFromCache('1'));
});

test('a cache that parses to something other than an array throws', async () => {
  await assertUntouched({ 'exercises.json': '{}' }, () => cache.appendToCache([exercise('2')]));
});

test('an unparseable deleted-exercise list throws, and a remove touches neither file', async () => {
  const files = { 'exercises.json': valid, 'deletedExercises.json': '["1", ' };
  await assertUntouched(files, () => cache.readDeletedIds());
  await assertUntouched(files, () => cache.removeFromCache('1'));
});
