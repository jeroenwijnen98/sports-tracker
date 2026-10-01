// @ts-check

/**
 * Which exercise the detail view has open, so a detail data load that
 * resolves late can tell whether its view is still the one on screen.
 * @typedef {{ readonly exerciseId: string }} ViewTicket
 */

/**
 * Track the open detail view. `open` hands out a ticket for each opening;
 * a ticket stops being current when another exercise (or the same one again)
 * is opened, or when the view is closed. No DOM, so Node tests import it.
 */
export function createCurrentView() {
  /** @type {ViewTicket | null} */
  let current = null;

  return {
    /**
     * @param {string} exerciseId
     * @returns {ViewTicket}
     */
    open(exerciseId) {
      current = { exerciseId };
      return current;
    },
    close() {
      current = null;
    },
    /** @param {ViewTicket} ticket */
    isCurrent(ticket) {
      return ticket === current;
    },
  };
}
