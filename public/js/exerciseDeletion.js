// @ts-check

/**
 * Delete exercise `id` everywhere it is kept, in this order: on the server
 * first, so a failure there throws before IndexedDB is touched; then out of
 * IndexedDB through intake's `remove`, which clears the overlap it leaves
 * behind; then its detail data through the detail loader's `forget`, which
 * waits for any load of it in flight. No DOM: the detail view supplies the
 * three steps, Node tests fakes.
 *
 * @param {string} id
 * @param {{
 *   deleteOnServer: (id: string) => Promise<void>,
 *   remove: (id: string) => Promise<void>,
 *   forget: (id: string) => Promise<void>,
 * }} steps
 * @returns {Promise<void>}
 */
export async function deleteExercise(id, { deleteOnServer, remove, forget }) {
  await deleteOnServer(id);
  await remove(id);
  await forget(id);
}
