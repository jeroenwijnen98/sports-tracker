import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shoeTotals, oneDefault, createShoeOperations } from '../public/js/shoes.js';
import { ingest } from '../public/js/intake.js';

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

/**
 * An in-memory shoes and exercises store. The shoes store hands out ids like
 * IndexedDB's autoIncrement; `transactions` counts the transactions run.
 *
 * @param {Shoe[]} [initialShoes]
 * @param {Exercise[]} [initialExercises]
 */
function fakeStore(initialShoes = [], initialExercises = []) {
  /** @type {Map<number, Shoe>} */
  const shoes = new Map(initialShoes.map((s) => [/** @type {number} */ (s.id), { ...s }]));
  /** @type {Map<string, Exercise>} */
  const exercises = new Map(initialExercises.map((e) => [e.id, { ...e }]));
  let nextId = Math.max(0, ...shoes.keys()) + 1;
  const state = { shoes, exercises, transactions: 0 };

  /** @type {import('../public/js/shoes.js').ShoeStores} */
  const stores = {
    shoes: {
      get: async (key) => shoes.get(/** @type {number} */ (key)),
      getAll: async () => [...shoes.values()].map((s) => ({ ...s })),
      put: async (shoe) => { shoes.set(/** @type {number} */ (shoe.id), { ...shoe }); return /** @type {number} */ (shoe.id); },
      add: async (shoe) => { const id = nextId++; shoes.set(id, { ...shoe, id }); return id; },
      delete: async (key) => { shoes.delete(/** @type {number} */ (key)); },
    },
    exercises: {
      get: async (key) => exercises.get(/** @type {string} */ (key)),
      getAll: async () => [...exercises.values()].map((e) => ({ ...e })),
      put: async (ex) => { exercises.set(ex.id, { ...ex }); return ex.id; },
      add: async (ex) => { exercises.set(ex.id, { ...ex }); return ex.id; },
      delete: async (key) => { exercises.delete(/** @type {string} */ (key)); },
    },
  };

  const ops = createShoeOperations((fn) => {
    state.transactions++;
    return fn(stores);
  });
  return { ...ops, state };
}

/** @param {Map<number, Shoe>} shoes */
const defaults = (shoes) => [...shoes.values()].filter((s) => s.isDefault).map((s) => s.id);

/** @type {(id: number, isDefault?: boolean) => Shoe} */
const shoe = (id, isDefault = false) => ({ id, name: `Schoen ${id}`, initialKm: 0, isDefault });

test('adding the first shoe makes it the default', async () => {
  const store = fakeStore();
  const id = await store.addShoe({ name: 'Pegasus', brand: 'Nike', initialKm: 12 });
  assert.deepEqual(store.state.shoes.get(id), { id, name: 'Pegasus', brand: 'Nike', initialKm: 12, isDefault: true });
});

test('later shoes are not the default', async () => {
  const store = fakeStore();
  const first = await store.addShoe({ name: 'A', initialKm: 0 });
  await store.addShoe({ name: 'B', initialKm: 0 });
  await store.addShoe({ name: 'C', initialKm: 0 });
  assert.deepEqual(defaults(store.state.shoes), [first]);
});

test('deleting the default shoe promotes a remaining shoe', async () => {
  const store = fakeStore([shoe(1, true), shoe(2), shoe(3)]);
  await store.deleteShoe(1);
  assert.deepEqual(defaults(store.state.shoes), [3]);
});

test('deleting another shoe keeps the default', async () => {
  const store = fakeStore([shoe(1), shoe(2, true), shoe(3)]);
  await store.deleteShoe(3);
  assert.deepEqual(defaults(store.state.shoes), [2]);
});

test('deleting the last shoe leaves none', async () => {
  const store = fakeStore([shoe(1, true)]);
  await store.deleteShoe(1);
  assert.equal(store.state.shoes.size, 0);
});

test('deleting a shoe unassigns its exercises in the same transaction', async () => {
  const store = fakeStore([shoe(1, true), shoe(2)], [run('a', 5000, 1), run('b', 5000, 2), run('c', 5000)]);
  await store.deleteShoe(1);
  assert.equal(store.state.transactions, 1);
  assert.equal('shoeId' in /** @type {Exercise} */ (store.state.exercises.get('a')), false);
  assert.equal(store.state.exercises.get('b')?.shoeId, 2);
  assert.equal(store.state.exercises.get('c')?.shoeId, undefined);
});

test('setting a default leaves exactly one default', async () => {
  const store = fakeStore([shoe(1, true), shoe(2), shoe(3)]);
  await store.setDefaultShoe(2);
  assert.deepEqual(defaults(store.state.shoes), [2]);
  await store.setDefaultShoe(2);
  assert.deepEqual(defaults(store.state.shoes), [2]);
});

test('a shoe change repairs a store with no default or several', async () => {
  const none = fakeStore([shoe(1), shoe(2)]);
  await none.updateShoe(1, { name: 'Nieuw', initialKm: 5 });
  assert.deepEqual(defaults(none.state.shoes), [2]);

  const several = fakeStore([shoe(1, true), shoe(2, true)]);
  await several.addShoe({ name: 'C', initialKm: 0 });
  assert.deepEqual(defaults(several.state.shoes), [1]);
});

test('updating a shoe changes its fields and keeps it the default', async () => {
  const store = fakeStore([shoe(1, true), shoe(2)]);
  await store.updateShoe(1, { name: 'Pegasus', brand: 'Nike', initialKm: 40 });
  assert.deepEqual(store.state.shoes.get(1), { id: 1, name: 'Pegasus', brand: 'Nike', initialKm: 40, isDefault: true });
  assert.deepEqual(defaults(store.state.shoes), [1]);
});

test('each operation is one transaction', async () => {
  const store = fakeStore([shoe(1, true)], [run('a', 5000, 1)]);
  await store.addShoe({ name: 'B', initialKm: 0 });
  await store.updateShoe(2, { name: 'B2', initialKm: 0 });
  await store.setDefaultShoe(2);
  await store.deleteShoe(2);
  assert.equal(store.state.transactions, 4);
});

test('after deleting the default shoe, synced exercises get the promoted default', async () => {
  const store = fakeStore([shoe(1, true), shoe(2)]);
  await store.deleteShoe(1);
  const { toSave } = ingest([run('new', 5000)], { existing: [], shoes: [...store.state.shoes.values()] });
  assert.equal(toSave[0].shoeId, 2);
});

test('oneDefault writes only the shoes that change', () => {
  assert.deepEqual(oneDefault([shoe(1, true), shoe(2), shoe(3)], 3), [shoe(1), shoe(3, true)]);
  assert.deepEqual(oneDefault([shoe(1, true), shoe(2)]), []);
  assert.deepEqual(oneDefault([]), []);
});
