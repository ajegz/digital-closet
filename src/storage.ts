import type { ClosetItem, Outfit, WearLog } from "./types";

// IndexedDB is the source of truth on this device; src/sync.ts mirrors it to Supabase.
const DB_NAME = "digital-closet";
// v1: items, meta. v2 (Phase 4): outfits, wearLogs.
const DB_VERSION = 2;

type StoreName = "items" | "meta" | "outfits" | "wearLogs";
const RECORD_STORES = ["items", "outfits", "wearLogs"] as const;

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of RECORD_STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function run<T>(storeName: StoreName, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
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

/** Add a validated batch atomically. Existing IDs (including tombstones) must never be overwritten. */
export async function saveItems(items: ClosetItem[]): Promise<void> {
  if (items.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("items", "readwrite");
    const store = transaction.objectStore("items");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("The import was cancelled. No pieces were added."));
    try {
      for (const item of items) store.add(item);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}
export const removeItem = (id: string) => run("items", "readwrite", (store) => store.delete(id));
export const getItem = (id: string) => run<ClosetItem | undefined>("items", "readonly", (store) => store.get(id));

// Outfits and wear logs share one shape of storage; RecordStore names which one.
export type RecordStore = "outfits" | "wearLogs";
type RecordOf<S extends RecordStore> = S extends "outfits" ? Outfit : WearLog;

export const loadRecords = <S extends RecordStore>(store: S) => run<RecordOf<S>[]>(store, "readonly", (objectStore) => objectStore.getAll());
export const getRecord = <S extends RecordStore>(store: S, id: string) => run<RecordOf<S> | undefined>(store, "readonly", (objectStore) => objectStore.get(id));
export const saveRecord = <S extends RecordStore>(store: S, record: RecordOf<S>) => run(store, "readwrite", (objectStore) => objectStore.put(record));
export const removeRecord = (store: RecordStore, id: string) => run(store, "readwrite", (objectStore) => objectStore.delete(id));

/** Wipes this device's closet, used when signing out. */
export async function clearAll() {
  const db = await openDb();
  const stores: StoreName[] = [...RECORD_STORES, "meta"];
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(stores, "readwrite");
    for (const name of stores) transaction.objectStore(name).clear();
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
