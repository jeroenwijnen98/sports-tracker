import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBusyGuard } from '../public/js/utils/busyGuard.js';

/** A promise and the function that resolves it. */
function deferred() {
  /** @type {(value?: unknown) => void} */
  let resolve = () => {};
  /** @type {Promise<unknown>} */
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('a second run while the first is busy is refused and never called', async () => {
  const guard = createBusyGuard();
  const first = deferred();
  let secondCalled = false;

  const sync = guard.run(() => first.promise.then(() => 'synced'));
  const fileImport = await guard.run(async () => { secondCalled = true; });

  assert.deepEqual(fileImport, { ran: false });
  assert.equal(secondCalled, false);
  assert.equal(guard.busy, true);

  first.resolve();
  assert.deepEqual(await sync, { ran: true, result: 'synced' });
  assert.equal(guard.busy, false);
});

test('a failed run releases the guard and passes its error on', async () => {
  const guard = createBusyGuard();
  await assert.rejects(guard.run(async () => { throw new Error('sync failed'); }), /sync failed/);
  assert.equal(guard.busy, false);
  assert.deepEqual(await guard.run(async () => 1), { ran: true, result: 1 });
});

test('onChange hears busy and free, also around a failure', async () => {
  /** @type {boolean[]} */
  const seen = [];
  const guard = createBusyGuard((busy) => seen.push(busy));
  await guard.run(async () => {});
  await guard.run(async () => { throw new Error('x'); }).catch(() => {});
  await guard.run(async () => {});
  assert.deepEqual(seen, [true, false, true, false, true, false]);
});
