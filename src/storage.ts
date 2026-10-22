import type { ClosetItem } from "./types";

// Everything lives in this browser's IndexedDB until accounts and cloud sync arrive (Phase 3).
const DB_NAME = "digital-closet";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("items", { keyPath: "id" });
      request.result.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function run<T>(storeName: "items" | "meta", mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const loadItems = () => run<ClosetItem[]>("items", "readonly", (store) => store.getAll());
export const saveItem = (item: ClosetItem) => run("items", "readwrite", (store) => store.put(item));
export const removeItem = (id: string) => run("items", "readwrite", (store) => store.delete(id));
export const getItem = (id: string) => run<ClosetItem | undefined>("items", "readonly", (store) => store.get(id));

/** Wipes this device's closet, used when signing out. */
export async function clearAll() {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(["items", "meta"], "readwrite");
    transaction.objectStore("items").clear();
    transaction.objectStore("meta").clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

// Small app-wide values: "collections" (Collection records), "categories" (the pre-sync list of names,
// read once to migrate), "taskLog" (today's task progress) and "sync" (account and pull cursors).
export type MetaKey = "collections" | "categories" | "taskLog" | "sync";
export const loadMeta = <T>(key: MetaKey) => run<T | undefined>("meta", "readonly", (store) => store.get(key));
export const saveMeta = (key: MetaKey, value: unknown) => run("meta", "readwrite", (store) => store.put(value, key));
