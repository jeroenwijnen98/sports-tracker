// @ts-check

/** @typedef {import('../../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../../types/domain.ts').Shoe} Shoe */

/** @typedef {{ key: string, value: unknown }} Setting */

/**
 * What each object store holds, so `getAll('shoes')` resolves to `Shoe[]`.
 * @typedef {{ exercises: Exercise, shoes: Shoe, settings: Setting }} Stores
 * @typedef {keyof Stores} StoreName
 */

const DB_NAME = 'sports-tracker';
const DB_VERSION = 1;

/** @type {Promise<IDBDatabase> | undefined} */
let dbPromise;

/** @returns {Promise<IDBDatabase>} */
function open() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

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
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
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
