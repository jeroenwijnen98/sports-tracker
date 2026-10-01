// @ts-check

import { getAll, transaction } from './db.js';

/** @typedef {import('../../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../../types/domain.ts').Shoe} Shoe */

/**
 * The stores a shoe change touches, inside one transaction.
 * @typedef {{ shoes: import('./db.js').TxStore<Shoe>, exercises: import('./db.js').TxStore<Exercise> }} ShoeStores
 */

/**
 * Runs `fn` as one transaction over the shoes and exercises stores. Node
 * tests pass an in-memory one.
 * @typedef {<R>(fn: (stores: ShoeStores) => Promise<R>) => Promise<R>} ShoeTransaction
 */

/** What the shoe form fills in. @typedef {Pick<Shoe, 'name' | 'brand' | 'initialKm'>} ShoeFields */

/**
 * Each shoe's total km: its initial km plus the distance of every exercise
 * assigned to it. Overlap exercises do not count, and exercises without a shoe
 * or assigned to a shoe not in `shoes` are ignored. Pure: derived on render,
 * never stored.
 *
 * @param {Shoe[]} shoes
 * @param {Exercise[]} exercises
 * @returns {Map<number, number>} Total km per shoe id.
 */
export function shoeTotals(shoes, exercises) {
  /** @type {Map<number, number>} */
  const totals = new Map();
  for (const shoe of shoes) {
    if (shoe.id !== undefined) totals.set(shoe.id, shoe.initialKm || 0);
  }
  for (const ex of exercises) {
    if (ex.overlap || ex.shoeId === undefined) continue;
    const km = totals.get(ex.shoeId);
    if (km !== undefined) totals.set(ex.shoeId, km + (ex.distance || 0) / 1000);
  }
  return totals;
}

/**
 * Every stored shoe with its total km, for the shoes tab to render.
 * @returns {Promise<{ shoes: Shoe[], totals: Map<number, number> }>}
 */
export async function loadShoes() {
  const [shoes, exercises] = await Promise.all([getAll('shoes'), getAll('exercises')]);
  return { shoes, totals: shoeTotals(shoes, exercises) };
}

/**
 * The writes that leave exactly one default shoe among `shoes`: `preferId` if
 * it is one of them, else the current default (the first, if there are
 * several), else the newest shoe (highest id). Pure; returns only the shoes
 * whose `isDefault` changes, as new objects.
 *
 * @param {Shoe[]} shoes Stored shoes, each with an id.
 * @param {number} [preferId]
 * @returns {Shoe[]}
 */
export function oneDefault(shoes, preferId) {
  if (shoes.length === 0) return [];
  const ids = shoes.map((s) => /** @type {number} */ (s.id));
  const target = preferId !== undefined && ids.includes(preferId)
    ? preferId
    : shoes.find((s) => s.isDefault)?.id ?? Math.max(...ids);
  return shoes
    .filter((s) => s.isDefault !== (s.id === target))
    .map((s) => ({ ...s, isDefault: s.id === target }));
}

/**
 * The shoe operations, each one transaction that leaves exactly one default
 * shoe whenever any shoe exists.
 *
 * @param {ShoeTransaction} transact
 */
export function createShoeOperations(transact) {
  /**
   * @param {ShoeStores['shoes']} store
   * @param {number} [preferId]
   */
  async function writeOneDefault(store, preferId) {
    for (const shoe of oneDefault(await store.getAll(), preferId)) await store.put(shoe);
  }

  return {
    /**
     * Store a new shoe. The first shoe becomes the default; later ones do not.
     * @param {ShoeFields} fields
     * @returns {Promise<number>} The new shoe's id.
     */
    addShoe: (fields) => transact(async ({ shoes }) => {
      const existing = await shoes.getAll();
      const isDefault = !existing.some((s) => s.isDefault);
      const id = /** @type {number} */ (await shoes.add({ ...fields, isDefault }));
      await writeOneDefault(shoes);
      return id;
    }),

    /**
     * Change a shoe's name, brand and initial km. Whether it is the default
     * is left as stored.
     * @param {number} id
     * @param {ShoeFields} fields
     */
    updateShoe: (id, fields) => transact(async ({ shoes }) => {
      const stored = await shoes.get(id);
      if (!stored) throw new Error(`Shoe ${id} not found`);
      await shoes.put({ ...stored, name: fields.name, brand: fields.brand, initialKm: fields.initialKm });
      await writeOneDefault(shoes);
    }),

    /**
     * Delete a shoe and unassign its exercises. Deleting the default shoe
     * makes another remaining shoe the default.
     * @param {number} id
     */
    deleteShoe: (id) => transact(async ({ shoes, exercises }) => {
      for (const ex of await exercises.getAll()) {
        if (ex.shoeId !== id) continue;
        const { shoeId, ...unassigned } = ex;
        await exercises.put(unassigned);
      }
      await shoes.delete(id);
      await writeOneDefault(shoes);
    }),

    /**
     * Make one shoe the default, and no other.
     * @param {number} id
     */
    setDefaultShoe: (id) => transact(async ({ shoes }) => {
      await writeOneDefault(shoes, id);
    }),
  };
}

export const { addShoe, updateShoe, deleteShoe, setDefaultShoe } = createShoeOperations(
  (fn) => transaction(['shoes', 'exercises'], fn),
);
