// @ts-check

/** @typedef {import('./intake.js').IntakeCounts} IntakeCounts */
/** @typedef {import('./api.js').ImportedExercise} ImportedExercise */
/** @typedef {import('../../types/domain.ts').Exercise} Exercise */

/**
 * The parts of a Polar data export's `products-devices` file used to name devices.
 * @typedef {object} ProductsDevices
 * @property {{ deviceId?: string, name?: string }[]} [devices]
 * @property {{ deviceId: string, archived?: string }[]} [archivedDevices]
 * @property {{ eventType?: string, modelName?: string, archived?: string }[]} [productRegistrationEvents]
 */

/**
 * Device id → device name, read from the text of a Polar data export's
 * `products-devices` file. Current devices carry their name; an archived
 * device is named by the DELETE registration event archived at the same
 * moment. Pure; a malformed file yields an empty map rather than failing the
 * import.
 *
 * @param {string} contents
 * @returns {Map<string, string>}
 */
export function parseDeviceMap(contents) {
  /** @type {Map<string, string>} */
  const deviceMap = new Map();
  try {
    /** @type {ProductsDevices} */
    const pd = JSON.parse(contents);
    for (const d of pd.devices || []) {
      if (d.deviceId && d.name) deviceMap.set(d.deviceId, d.name);
    }
    const archived = pd.archivedDevices || [];
    for (const evt of pd.productRegistrationEvents || []) {
      if (evt.eventType !== 'DELETE' || !evt.modelName) continue;
      const dev = archived.find((d) => d.archived === evt.archived);
      if (dev) deviceMap.set(dev.deviceId, evt.modelName);
    }
  } catch {
    return new Map();
  }
  return deviceMap;
}

/**
 * The toast after an import, from what intake did plus the files the server
 * already had (a 409). Both kinds of duplicate are shown as one number.
 *
 * @param {IntakeCounts} counts
 * @param {number} duplicates
 * @returns {{ message: string, type: 'success' | 'info' }}
 */
export function importToast(counts, duplicates) {
  const parts = [];
  const allDuplicates = duplicates + counts.duplicates;
  if (counts.newExercises > 0) parts.push(`${counts.newExercises} geïmporteerd`);
  if (allDuplicates > 0) parts.push(`${allDuplicates} duplicaat`);
  if (counts.overlaps > 0) parts.push(`${counts.overlaps} overlap gemarkeerd`);

  if (counts.newExercises > 0) return { message: parts.join(', '), type: 'success' };
  if (parts.length > 0) return { message: parts.join(', '), type: 'info' };
  return { message: 'Geen hardloopactiviteiten gevonden in de bestanden', type: 'info' };
}

/**
 * A file to import, read the way a browser `File` is.
 * @typedef {{ name: string, text(): Promise<string> }} ImportFile
 */

/**
 * The calls the import pipeline makes: the two import routes (each resolving
 * to the stored exercise flagged `_duplicate` on a 409) and intake.
 * @typedef {object} ImportAdapters
 * @property {(xml: string) => Promise<ImportedExercise>} importTcx
 * @property {(session: unknown) => Promise<ImportedExercise>} importJson
 * @property {(incoming: Exercise[]) => Promise<{ counts: IntakeCounts, newIds: string[] }>} ingestAndSave
 */

/**
 * The import pipeline behind the import button. Builds the device map from
 * every `products-devices*` file, sends each `.json` file to the JSON import
 * (skipping JSON without `exercises`: activity summaries, heart rate data and
 * the like) and every other file to the TCX import, counts the files the server
 * already had, renames each exercise's device through the map, and hands the
 * rest to intake. A file that fails is logged and the batch goes on. No DOM.
 *
 * @param {ImportFile[]} files
 * @param {ImportAdapters} adapters
 * @returns {Promise<{ counts: IntakeCounts, duplicates: number, newIds: string[] }>}
 */
export async function importFiles(files, { importTcx, importJson, ingestAndSave }) {
  /** @type {Map<string, string>} */
  const deviceMap = new Map();
  for (const file of files) {
    if (!file.name.startsWith('products-devices')) continue;
    for (const [id, name] of parseDeviceMap(await file.text())) deviceMap.set(id, name);
  }

  /** @type {Exercise[]} */
  const imported = [];
  let duplicates = 0;
  for (const file of files) {
    try {
      /** @type {ImportedExercise} */
      let exercise;
      if (file.name.endsWith('.json')) {
        const json = JSON.parse(await file.text());
        if (!json.exercises?.length) continue;
        exercise = await importJson(json);
      } else {
        exercise = await importTcx(await file.text());
      }
      if (exercise._duplicate) {
        duplicates++;
        continue;
      }
      const device = exercise.device && deviceMap.get(exercise.device);
      imported.push(device ? { ...exercise, device } : exercise);
    } catch (err) {
      console.error(`Import failed for ${file.name}:`, /** @type {Error} */ (err).message, err);
    }
  }

  const { counts, newIds } = await ingestAndSave(imported);
  return { counts, duplicates, newIds };
}
