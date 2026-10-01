// @ts-check

/** @typedef {import('../../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../../types/domain.ts').Shoe} Shoe */
/** @typedef {import('../../types/domain.ts').DetailData} DetailData */

/** @typedef {{ key: string, value: unknown }} Setting */

/**
 * The detail data of one exercise, keyed by its id, or the marker left when
 * neither TCX nor GPX could be fetched. Only `services/detailData.js` uses it.
 * @typedef {{ id: string, detail: DetailData }
 *   | { id: string, unavailable: true, checkedAt: number }} DetailsEntry
 */

/**
 * What each object store holds, so `getAll('shoes')` resolves to `Shoe[]`.
 * @typedef {{ exercises: Exercise, shoes: Shoe, settings: Setting, details: DetailsEntry }} Stores
 * @typedef {keyof Stores} StoreName
 */

const DB_NAME = 'sports-tracker';
const DB_VERSION = 2;

/** @type {Promise<IDBDatabase> | undefined} */
let dbPromise;

/** @returns {Promise<IDBDatabase>} */
function open() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const upgrade = /** @type {IDBTransaction} */ (req.transaction);

      if (!db.objectStoreNames.contains('exercises')) {
        db.createObjectStore('exercises', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('shoes')) {
        const store = db.createObjectStore('shoes', { keyPath: 'id', autoIncrement: true });
        store.createIndex('isDefault', 'isDefault', { unique: false });
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains('details')) {
        db.createObjectStore('details', { keyPath: 'id' });
        if (event.oldVersion >= 1) moveDetailData(upgrade);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

/**
 * Version 1 kept detail data as a `detailData` field on each exercise. Split a
 * version 1 exercise record into the exercise without it and its details
 * entry, if it had one. Old unavailable markers carry `timestamp` instead of
 * `checkedAt`.
 *
 * @param {Exercise & { detailData?: any }} record
 * @returns {{ exercise: Exercise, entry: DetailsEntry | null }}
 */
export function splitDetailData(record) {
  const { detailData, ...exercise } = record;
  if (!detailData) return { exercise, entry: null };
  /** @type {DetailsEntry} */
  const entry = detailData.unavailable
    ? { id: exercise.id, unavailable: true, checkedAt: detailData.checkedAt ?? detailData.timestamp ?? 0 }
    : { id: exercise.id, detail: detailData };
  return { exercise, entry };
}

/**
 * Move every exercise's `detailData` into the details store.
 *
 * @param {IDBTransaction} upgrade The version change transaction.
 */
function moveDetailData(upgrade) {
  const details = upgrade.objectStore('details');
  const cursorReq = upgrade.objectStore('exercises').openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    const { exercise, entry } = splitDetailData(cursor.value);
    if (entry) {
      details.put(entry);
      cursor.update(exercise);
    }
    cursor.continue();
  };
}

/**
 * @param {StoreName} storeName
 * @param {IDBTransactionMode} [mode]
 */
async function tx(storeName, mode = 'readonly') {
  const db = await open();
  return db.transaction(storeName, mode).objectStore(storeName);
}

/**
 * @template T
 * @param {IDBRequest<T>} req
 * @returns {Promise<T>}
 */
function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @template {StoreName} S
 * @param {S} storeName
 * @returns {Promise<Stores[S][]>}
 */
export async function getAll(storeName) {
  const store = await tx(storeName);
  return reqToPromise(store.getAll());
}

/**
 * @template {StoreName} S
 * @param {S} storeName
 * @param {IDBValidKey} key
 * @returns {Promise<Stores[S] | undefined>}
 */
export async function get(storeName, key) {
  const store = await tx(storeName);
  return reqToPromise(store.get(key));
}

/**
 * @template {StoreName} S
 * @param {S} storeName
 * @param {Stores[S]} item
 * @returns {Promise<IDBValidKey>}
 */
export async function put(storeName, item) {
  const store = await tx(storeName, 'readwrite');
  return reqToPromise(store.put(item));
}

/**
 * @template {StoreName} S
 * @param {S} storeName
 * @param {Stores[S]} item
 * @returns {Promise<IDBValidKey>}
 */
export async function add(storeName, item) {
  const store = await tx(storeName, 'readwrite');
  return reqToPromise(store.add(item));
}

/**
 * @param {StoreName} storeName
 * @param {IDBValidKey} key
 * @returns {Promise<void>}
 */
export async function del(storeName, key) {
  const store = await tx(storeName, 'readwrite');
  return reqToPromise(store.delete(key));
}

/**
 * @template {StoreName} S
 * @param {S} storeName
 * @param {Stores[S][]} items
 * @returns {Promise<void>}
 */
export async function putMany(storeName, items) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    for (const item of items) {
      store.put(item);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * @param {string} key
 * @returns {Promise<unknown>}
 */
export async function getSetting(key) {
  const record = await get('settings', key);
  return record?.value;
}

/**
 * @param {string} key
 * @param {unknown} value
 */
export async function setSetting(key, value) {
  return put('settings', { key, value });
}
