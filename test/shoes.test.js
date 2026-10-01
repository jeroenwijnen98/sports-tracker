import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shoeTotals } from '../public/js/shoes.js';

/** @typedef {import('../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../types/domain.ts').Shoe} Shoe */

/** @type {(id: string, distance: number, shoeId?: number, overlap?: boolean) => Exercise} */
const run = (id, distance, shoeId, overlap) => ({
  id,
  'start-time': '2000-01-01T08:00:00.000',
  duration: 'PT30M',
  distance,
  'detailed-sport-info': 'RUNNING',
  shoeId,
  overlap,
});

/** @type {Shoe[]} */
const shoes = [
  { id: 1, name: 'Oud', initialKm: 120, isDefault: false },
  { id: 2, name: 'Nieuw', initialKm: 0, isDefault: true },
];

test('initial km plus the distance of every assigned exercise', () => {
  const totals = shoeTotals(shoes, [run('a', 5000, 1), run('b', 10500, 1)]);
  assert.equal(totals.get(1), 135.5);
});

test('overlap exercises do not count', () => {
  const totals = shoeTotals(shoes, [run('a', 5000, 2), run('b', 5000, 2, true)]);
  assert.equal(totals.get(2), 5);
});

test('unassigned exercises and exercises of another shoe are ignored', () => {
  const totals = shoeTotals(shoes, [run('a', 5000), run('b', 8000, 2), run('c', 3000, 99)]);
  assert.equal(totals.get(1), 120);
  assert.equal(totals.get(2), 8);
  assert.equal(totals.size, 2);
});

test('a shoe with no exercises shows its initial km', () => {
  assert.deepEqual([...shoeTotals(shoes, []).entries()], [[1, 120], [2, 0]]);
});

test('reads its arguments without changing them', () => {
  const exercises = [run('a', 5000, 1)];
  const before = JSON.stringify({ shoes, exercises });
  shoeTotals(shoes, exercises);
  assert.equal(JSON.stringify({ shoes, exercises }), before);
});
