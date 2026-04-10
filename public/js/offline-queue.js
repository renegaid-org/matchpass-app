const DB_NAME = 'matchpass-offline';
const DB_VERSION = 1;
const STORE_NAME = 'queue';

let db = null;

/**
 * Open the IndexedDB database.
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => { db = request.result; resolve(db); };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Queue an API request for later sync.
 * Stores: { path, method, body, timestamp }
 */
export async function queueRequest(path, method, body) {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add({
      path,
      method,
      body,
      timestamp: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all queued requests.
 */
export async function getQueued() {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove a queued request by ID after successful sync.
 */
export async function removeQueued(id) {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get count of queued items.
 */
export async function getQueueCount() {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Sync all queued requests to the server.
 * Called when connection returns.
 * Returns { synced, failed } counts.
 */
export async function syncQueue(apiFn) {
  const queued = await getQueued();
  let synced = 0;
  let failed = 0;

  for (const item of queued) {
    // Reject items older than 4 hours
    if (Date.now() - item.timestamp > 4 * 60 * 60 * 1000) {
      console.warn(`Offline sync: discarding stale request to ${item.path} (${Math.round((Date.now() - item.timestamp) / 60000)}min old)`);
      await removeQueued(item.id);
      failed++;
      continue;
    }
    try {
      await apiFn(item.path, {
        method: item.method,
        body: item.body,
      });
      await removeQueued(item.id);
      synced++;
    } catch (err) {
      console.error(`Offline sync failed for ${item.path}:`, err);
      failed++;
    }
  }

  console.log(`Offline sync: ${synced} synced, ${failed} failed, ${queued.length} total`);
  return { synced, failed };
}

/**
 * Purge stale items on startup.
 * 4-hour TTL limits exposure on seized devices.
 * Full mitigation requires device-level encryption (OS-level, not app-level) —
 * this is a known limitation accepted for the pilot.
 */
async function autoPurge() {
  if (!db) await openDB();
  const items = await getQueued();
  for (const item of items) {
    if (Date.now() - item.timestamp > 4 * 60 * 60 * 1000) {
      await removeQueued(item.id);
    }
  }
}

// Init DB on import, then purge any stale items
openDB().then(() => autoPurge()).catch(err => console.error('IndexedDB init failed:', err));
