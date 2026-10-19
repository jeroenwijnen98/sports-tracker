import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteExercise } from '../public/js/exerciseDeletion.js';

/** Fakes for the three steps that record the order they are called in. */
function steps({ serverFails = false } = {}) {
  /** @type {string[]} */
  const calls = [];
  return {
    calls,
    deleteOnServer: async (/** @type {string} */ id) => {
      calls.push(`server ${id}`);
      if (serverFails) throw new Error('Delete failed: 500');
    },
    remove: async (/** @type {string} */ id) => { calls.push(`remove ${id}`); },
    forget: async (/** @type {string} */ id) => { calls.push(`forget ${id}`); },
  };
}

test('deletes on the server, then through intake, then forgets the detail data', async () => {
  const s = steps();
  await deleteExercise('w1', s);
  assert.deepEqual(s.calls, ['server w1', 'remove w1', 'forget w1']);
});

test('a failing server delete throws and leaves IndexedDB and detail data alone', async () => {
  const s = steps({ serverFails: true });
  await assert.rejects(deleteExercise('w1', s), /Delete failed: 500/);
  assert.deepEqual(s.calls, ['server w1']);
});
