const DB_NAME = 'sports-tracker';
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

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

async function tx(storeName, mode = 'readonly') {
  const db = await open();
  return db.transaction(storeName, mode).objectStore(storeName);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(storeName) {
  const store = await tx(storeName);
  return reqToPromise(store.getAll());
}

export async function get(storeName, key) {
  const store = await tx(storeName);
  return reqToPromise(store.get(key));
}

export async function put(storeName, item) {
  const store = await tx(storeName, 'readwrite');
  return reqToPromise(store.put(item));
}

export async function add(storeName, item) {
  const store = await tx(storeName, 'readwrite');
  return reqToPromise(store.add(item));
}

export async function del(storeName, key) {
  const store = await tx(storeName, 'readwrite');
  return reqToPromise(store.delete(key));
}

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

export async function getSetting(key) {
  const record = await get('settings', key);
  return record?.value;
}

export async function setSetting(key, value) {
  return put('settings', { key, value });
}
