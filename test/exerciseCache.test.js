import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { exitedPid } from './helpers/process.js';

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

test('many concurrent appends of distinct exercises all end up in the cache', async () => {
  await writeFile(join(dir, 'exercises.json'), '[]');
  const ids = Array.from({ length: 50 }, (_, i) => `c${i}`);

  const added = await Promise.all(ids.map((id) => cache.appendToCache([exercise(id)])));

  assert.deepEqual(added, ids.map(() => 1));
  assert.deepEqual((await cache.readCache()).map((e) => e.id).sort(), [...ids].sort());
});

test('concurrent append, revert and remove leave both files as if run one after another', async () => {
  await writeFile(join(dir, 'exercises.json'), JSON.stringify(['a', 'b', 'c'].map(exercise)));
  await writeFile(join(dir, 'deletedExercises.json'), '[]');

  const results = await Promise.all([
    cache.appendToCache([exercise('d')]),
    cache.revertAppend('a'),
    cache.removeFromCache('b'),
    cache.appendToCache([exercise('e')]),
    cache.removeFromCache('d'),
    cache.revertAppend('e'),
  ]);

  assert.deepEqual(results, [1, undefined, true, 1, true, undefined]);
  assert.deepEqual((await cache.readCache()).map((e) => e.id), ['c']);
  assert.deepEqual([...(await cache.readDeletedIds())].sort(), ['b', 'd']);
});

test('a write that throws releases the queue and the lock for the next one', async () => {
  await writeFile(join(dir, 'exercises.json'), truncated);
  const failing = cache.appendToCache([exercise('x')]);
  // Queued behind the failing one, and run after it once the file is fixed
  const next = failing.catch(async () => {
    await writeFile(join(dir, 'exercises.json'), '[]');
  }).then(() => cache.appendToCache([exercise('y')]));

  await assert.rejects(failing, cache.CorruptCacheError);
  assert.equal(await next, 1);
  assert.deepEqual((await cache.readCache()).map((e) => e.id), ['y']);
  assert.equal((await readdir(dir)).includes('exercises.lock'), false);
});

test('a write waits while another process holds the lock and runs once it is released', async () => {
  await writeFile(join(dir, 'exercises.json'), '[]');
  // The test runner that started this file: a process that is running
  await writeFile(join(dir, 'exercises.lock'), `${process.ppid} other`);

  let done = false;
  const append = cache.appendToCache([exercise('w')]).then((n) => { done = true; return n; });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(done, false);
  assert.deepEqual(await cache.readCache(), []);

  await rm(join(dir, 'exercises.lock'));
  assert.equal(await append, 1);
  assert.deepEqual((await cache.readCache()).map((e) => e.id), ['w']);
});

test('a lock left by a process that no longer runs does not block a write', async () => {
  await writeFile(join(dir, 'exercises.json'), '[]');
  await writeFile(join(dir, 'exercises.lock'), `${await exitedPid()} gone`);

  assert.equal(await cache.appendToCache([exercise('s')]), 1);
  assert.equal((await readdir(dir)).includes('exercises.lock'), false);
});

test('appends from two processes at once all end up in the cache', async () => {
  await writeFile(join(dir, 'exercises.json'), '[]');
  const ids = (/** @type {string} */ prefix) => Array.from({ length: 100 }, (_, i) => `${prefix}${i}`);
  // The child starts appending when the parent does, on a line on its stdin
  const script = `
    const cache = await import(${JSON.stringify(new URL('../src/services/exerciseCache.ts', import.meta.url).href)});
    const ex = (id) => ({ id, 'start-time': '2000-01-01T08:00:00.000', duration: 'PT30M', 'detailed-sport-info': 'RUNNING' });
    process.stdout.write('ready');
    await new Promise((resolve) => process.stdin.once('data', resolve));
    process.stdin.destroy();
    for (const id of ${JSON.stringify(ids('child'))}) await cache.appendToCache([ex(id)]);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, SPORTS_DATA_DIR: dir },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  // Fails rather than hangs should the child die before it is ready
  await Promise.race([
    new Promise((resolve) => child.stdout.once('data', resolve)),
    exited.then((code) => assert.fail(`child exited early with ${code}`)),
  ]);

  child.stdin.end('go\n');
  for (const id of ids('parent')) await cache.appendToCache([exercise(id)]);
  assert.equal(await exited, 0);

  const cached = (await cache.readCache()).map((e) => e.id).sort();
  assert.deepEqual(cached, [...ids('child'), ...ids('parent')].sort());
});
