// @ts-check

/** @typedef {import('./intake.js').IntakeCounts} IntakeCounts */

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
