// @ts-check

/** @typedef {import('../../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../../types/domain.ts').Shoe} Shoe */

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
