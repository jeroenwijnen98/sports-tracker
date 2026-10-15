// @ts-check

/**
 * One busy state shared by work that must not overlap, such as a sync and a
 * file import. `run(fn)` runs `fn` only when nothing else is running and
 * refuses it otherwise; the guard is released when `fn` settles, also when it
 * throws. `onChange` hears every change, so the page can show it. No DOM, so
 * Node tests import it.
 *
 * @param {(busy: boolean) => void} [onChange]
 */
export function createBusyGuard(onChange = () => {}) {
  let busy = false;

  return {
    get busy() {
      return busy;
    },

    /**
     * @template T
     * @param {() => Promise<T>} fn
     * @returns {Promise<{ ran: true, result: T } | { ran: false }>}
     */
    async run(fn) {
      if (busy) return { ran: false };
      busy = true;
      onChange(true);
      try {
        return { ran: true, result: await fn() };
      } finally {
        busy = false;
        onChange(false);
      }
    },
  };
}
