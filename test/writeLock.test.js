import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWriteLock, LockTimeoutError } from '../src/services/writeLock.ts';
import { exitedPid } from './helpers/process.js';

/** @type {string} */
let dir;
/** @type {string} */
let path;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sports-tracker-lock-'));
  path = join(dir, 'test.lock');
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('writes in one process run one at a time, in the order they were queued', async () => {
  const lock = createWriteLock(path);
  /** @type {string[]} */
  const log = [];
  /** @param {string} name @param {number} ms */
  const write = (name, ms) => lock.run(async () => {
    log.push(`${name} start`);
    await sleep(ms);
    log.push(`${name} end`);
    return name;
  });

  assert.deepEqual(await Promise.all([write('a', 30), write('b', 0), write('c', 10)]), ['a', 'b', 'c']);
  assert.deepEqual(log, ['a start', 'a end', 'b start', 'b end', 'c start', 'c end']);
});

test('the lock file holds this process while a write runs, and is gone after', async () => {
  const lock = createWriteLock(path);
  const holder = await lock.run(async () => (await readFile(path, 'utf-8')).split(' ')[0]);
  assert.equal(holder, String(process.pid));
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('a write that throws releases the queue and the lock', async () => {
  const lock = createWriteLock(path);
  const failing = lock.run(async () => { throw new Error('boom'); });
  const next = lock.run(async () => 'ran');

  await assert.rejects(failing, /boom/);
  assert.equal(await next, 'ran');
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('a lock held by a running process times out with a clear error, writing nothing', async () => {
  await writeFile(path, `${process.ppid} other`);
  const lock = createWriteLock(path, { timeoutMs: 100, pollMs: 10 });
  let ran = false;

  await assert.rejects(
    lock.run(async () => { ran = true; }),
    (err) => err instanceof LockTimeoutError && err.message.includes(`process ${process.ppid}`),
  );
  assert.equal(ran, false);
  assert.equal(await readFile(path, 'utf-8'), `${process.ppid} other`);

  // The queue is free again: once the other process lets go, the next write runs
  await rm(path);
  assert.equal(await lock.run(async () => 'ran'), 'ran');
});

test('a lock left by a process that no longer runs is taken over', async () => {
  await writeFile(path, `${await exitedPid()} gone`);
  const lock = createWriteLock(path, { timeoutMs: 100, pollMs: 10 });
  assert.equal(await lock.run(async () => 'ran'), 'ran');
});

test('an unreadable lock file waits until it is old enough to count as stale', async () => {
  await writeFile(path, '');
  const lock = createWriteLock(path, { timeoutMs: 100, pollMs: 10, unreadableStaleMs: 60_000 });
  await assert.rejects(lock.run(async () => {}), LockTimeoutError);

  const old = new Date(Date.now() - 120_000);
  await utimes(path, old, old);
  assert.equal(await lock.run(async () => 'ran'), 'ran');
});

test('a lock taken over by someone else is not removed on release', async () => {
  const lock = createWriteLock(path);
  await lock.run(async () => { await writeFile(path, `${process.ppid} other`); });
  assert.equal(await readFile(path, 'utf-8'), `${process.ppid} other`);
  await rm(path);
});
