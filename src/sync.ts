// Local-first sync with Supabase (docs/phase-3-plan.md).
// IndexedDB stays the source of truth on the device; this module pulls the cloud's changes,
// then pushes local ones. Conflicts resolve by the newest updated_at (last write wins).
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { blobToDataUrl, dataUrlToBlob, recompressDataUrl } from "./photos";
import { clearAll, getItem, getRecord, loadItems, loadMeta, loadRecords, removeItem, removeRecord, saveItem, saveMeta, saveRecord, type RecordStore } from "./storage";
import { PHOTO_BUCKET, supabase } from "./supabase";
import { UNKNOWN, type ClosetItem, type Collection, type Occasion, type Outfit, type WearLog, type Weather } from "./types";

type ItemRow = Database["public"]["Tables"]["items"]["Row"];
type ItemInsert = Database["public"]["Tables"]["items"]["Insert"];
type CollectionRow = Database["public"]["Tables"]["collections"]["Row"];
type OutfitRow = Database["public"]["Tables"]["outfits"]["Row"];
type WearLogRow = Database["public"]["Tables"]["wear_logs"]["Row"];

export type SyncState = "off" | "signed-out" | "syncing" | "synced" | "offline" | "error";

export interface SyncStatus {
  state: SyncState;
  email?: string;
  lastSyncedAt?: number;
  /** Local changes the cloud doesn't have yet. */
  pending: number;
  message?: string;
}

interface Cursor {
  at: string;
  id: string;
}

interface SyncMeta {
  /** The account this device's data belongs to. */
  userId?: string;
  items?: Cursor;
  collections?: Cursor;
  outfits?: Cursor;
  wearLogs?: Cursor;
  lastSyncedAt?: number;
}

const PAGE_SIZE = 500;
const PUSH_BATCH = 100;
const PUSH_DELAY_MS = 2000;
// Pull a minute behind the cursor: a row committed late can carry an older synced_at than one already seen.
const CURSOR_OVERLAP_MS = 60_000;
const UPLOADABLE = ["image/webp", "image/jpeg"];
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ZERO_ID = "00000000-0000-0000-0000-000000000000";

let session: Session | null = null;
let meta: SyncMeta = {};
let status: SyncStatus = { state: supabase ? "signed-out" : "off", pending: 0 };
let running: Promise<void> | null = null;
let rerun = false;
let timer: number | undefined;
let dataChanged = false;
let onDataChanged: () => void | Promise<void> = () => {};
const listeners = new Set<(status: SyncStatus) => void>();

/* ---------- Public API ---------- */

export const isSignedIn = () => Boolean(session);
export const getStatus = () => status;

export function onStatus(listener: (status: SyncStatus) => void) {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

export async function startSync(options: { onDataChanged: () => void | Promise<void> }) {
  onDataChanged = options.onDataChanged;
  if (!supabase) return;
  meta = (await loadMeta<SyncMeta>("sync")) ?? {};
  const { data } = await supabase.auth.getSession();
  await setSession(data.session);
  supabase.auth.onAuthStateChange((_event, next) => {
    // Calling Supabase from inside this callback can deadlock its auth lock, so defer.
    window.setTimeout(() => void setSession(next), 0);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestSync(0);
  });
  window.addEventListener("online", () => requestSync(0));
  window.addEventListener("offline", () => {
    if (session) setStatus({ state: "offline" });
  });
}

/** Call after any local change; syncs a moment later so a burst of edits goes up together. */
export function requestSync(delay = PUSH_DELAY_MS) {
  if (!session) return;
  void countPending().then((pending) => setStatus({ pending }));
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void syncNow(), delay);
}

export async function syncNow(): Promise<void> {
  if (!supabase || !session) return;
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      await runOnce();
    } while (rerun);
  })().finally(() => {
    running = null;
  });
  return running;
}

export async function sendCode(email: string) {
  if (!supabase) throw new Error("Cloud backup isn't configured");
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyCode(email: string, token: string) {
  if (!supabase) throw new Error("Cloud backup isn't configured");
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
}

/**
 * Syncs, then signs out and clears this device's copy so a shared device doesn't keep the closet.
 * Returns the number of unsynced changes instead of signing out, unless `force` is set.
 */
export async function signOut({ force = false } = {}) {
  if (!supabase || !session) return { pending: 0 };
  await syncNow();
  const pending = await countPending();
  if (pending && !force) return { pending };
  window.clearTimeout(timer);
  await supabase.auth.signOut({ scope: "local" });
  session = null;
  await clearAll();
  meta = {};
  setStatus({ state: "signed-out", email: undefined, lastSyncedAt: undefined, pending: 0, message: undefined });
  await onDataChanged();
  return { pending: 0 };
}

/* ---------- Session ---------- */

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((listener) => listener(status));
}

async function setSession(next: Session | null) {
  const previousUser = session?.user.id;
  session = next;
  if (!next) {
    setStatus({ state: "signed-out", email: undefined, message: undefined });
    return;
  }
  if (next.user.id === previousUser) return;
  if (meta.userId !== next.user.id) {
    // First sign-in on this device: the pieces already here join the account. Start the pulls from scratch.
    meta = { userId: next.user.id };
    await saveMeta("sync", meta);
  }
  setStatus({ email: next.user.email ?? undefined, lastSyncedAt: meta.lastSyncedAt });
  requestSync(0);
}

const userId = () => {
  if (!session) throw new Error("Not signed in");
  return session.user.id;
};

function client() {
  if (!supabase) throw new Error("Cloud backup isn't configured");
  return supabase;
}

/* ---------- One sync pass ---------- */

async function runOnce() {
  if (!navigator.onLine) {
    setStatus({ state: "offline", pending: await countPending() });
    return;
  }
  setStatus({ state: "syncing", message: undefined });
  dataChanged = false;
  try {
    await pullCollections();
    await pullItems();
    await pullRecords(OUTFITS);
    await pullRecords(WEAR_LOGS);
    await pushCollections();
    await pushItems();
    await pushRecords(OUTFITS);
    await pushRecords(WEAR_LOGS);
    meta.lastSyncedAt = Date.now();
    await saveMeta("sync", meta);
    setStatus({ state: "synced", lastSyncedAt: meta.lastSyncedAt, pending: await countPending() });
  } catch (error) {
    console.error("Sync failed", error);
    const offline = isNetworkError(error);
    setStatus({ state: offline ? "offline" : "error", message: offline ? undefined : describe(error), pending: await countPending() });
  } finally {
    if (dataChanged) await onDataChanged();
  }
}

function describe(error: unknown) {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error);
}

function isNetworkError(error: unknown) {
  return !navigator.onLine || /failed to fetch|networkerror|load failed|fetch failed/i.test(describe(error));
}

const needsPush = (item: ClosetItem) => item.dirty !== false && !item.sample;

async function countPending() {
  const [items, collections, outfits, wearLogs] = await Promise.all([loadItems(), loadMeta<Collection[]>("collections"), loadRecords("outfits"), loadRecords("wearLogs")]);
  const unsent = (records: { dirty?: boolean }[]) => records.filter((record) => record.dirty !== false).length;
  return items.filter(needsPush).length + unsent(collections ?? []) + unsent(outfits) + unsent(wearLogs);
}

// Keyset pagination on (synced_at, id) so rows sharing a timestamp are never skipped between pages.
function afterCursor(cursor: Cursor) {
  return `synced_at.gt."${cursor.at}",and(synced_at.eq."${cursor.at}",id.gt.${cursor.id})`;
}

function overlapStart(cursor?: Cursor): Cursor | undefined {
  if (!cursor) return undefined;
  return { at: new Date(Date.parse(cursor.at) - CURSOR_OVERLAP_MS).toISOString(), id: ZERO_ID };
}

/* ---------- Items ---------- */

async function pullItems() {
  let page = overlapStart(meta.items);
  for (;;) {
    let query = client().from("items").select("*").eq("user_id", userId()).order("synced_at").order("id").limit(PAGE_SIZE);
    if (page) query = query.or(afterCursor(page));
    const { data, error } = await query;
    if (error) throw error;
    for (const row of data) await applyRemoteItem(row);
    if (data.length) {
      const last = data[data.length - 1];
      page = { at: last.synced_at, id: last.id };
      if (!meta.items || last.synced_at > meta.items.at) meta.items = page;
      await saveMeta("sync", meta);
    }
    if (data.length < PAGE_SIZE) return;
  }
}

async function applyRemoteItem(row: ItemRow) {
  const local = await getItem(row.id);
  if (local?.remoteSyncedAt === row.synced_at) return;
  // An unsent local edit that's newer wins; the push step sends it.
  if (local && needsPush(local) && local.updatedAt > Date.parse(row.updated_at)) return;
  if (row.deleted_at) {
    if (local) {
      await removeItem(row.id);
      dataChanged = true;
    }
    return;
  }
  let image = local?.image;
  let thumb = local?.thumb;
  if (row.photo_path !== (local?.photoPath ?? null)) {
    [image, thumb] = row.photo_path
      ? await Promise.all([download(row.photo_path), download(row.thumb_path ?? row.photo_path)])
      : [undefined, undefined];
  }
  await saveItem(fromRow(row, image, thumb));
  dataChanged = true;
}

function fromRow(row: ItemRow, image?: string, thumb?: string): ClosetItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    brand: row.brand ?? UNKNOWN,
    color: row.color ?? UNKNOWN,
    status: row.status === "confirmed" ? "Confirmed" : "Needs review",
    favorite: row.favorite,
    size: row.size ?? undefined,
    material: row.material ?? undefined,
    weather: (row.weather ?? undefined) as Weather[] | undefined,
    occasions: (row.occasions ?? undefined) as Occasion[] | undefined,
    price: row.price === null ? undefined : Number(row.price),
    purchasedOn: row.purchased_on ?? undefined,
    store: row.store ?? undefined,
    care: row.care ?? undefined,
    image,
    thumb,
    photoPath: row.photo_path ?? undefined,
    thumbPath: row.thumb_path ?? undefined,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
    dirty: false,
    photoDirty: false,
    remoteSyncedAt: row.synced_at
  };
}

function toRow(item: ClosetItem, photoPath: string | null, thumbPath: string | null): ItemInsert {
  const iso = (time: number) => new Date(time).toISOString();
  return {
    id: item.id,
    user_id: userId(),
    name: item.name,
    category: item.category,
    brand: item.brand && item.brand !== UNKNOWN ? item.brand : null,
    color: item.color && item.color !== UNKNOWN ? item.color : null,
    status: item.status === "Confirmed" ? "confirmed" : "needs_review",
    favorite: item.favorite,
    size: item.size ?? null,
    material: item.material ?? null,
    weather: item.weather?.length ? item.weather : null,
    occasions: item.occasions?.length ? item.occasions : null,
    price: item.price ?? null,
    purchased_on: item.purchasedOn ?? null,
    store: item.store ?? null,
    care: item.care ?? null,
    photo_path: photoPath,
    thumb_path: thumbPath,
    created_at: iso(item.createdAt),
    updated_at: iso(item.updatedAt),
    deleted_at: item.deletedAt ? iso(item.deletedAt) : null
  };
}

interface Prepared {
  item: ClosetItem;
  row: ItemInsert;
  photoPath?: string;
  thumbPath?: string;
  /** Re-encoded photo, when the stored one was too big or the wrong type to upload. */
  recompressed?: { image: string; thumb: string };
  /** Old photo versions to delete once the row no longer points at them. */
  stalePaths: string[];
}

async function preparePush(item: ClosetItem): Promise<Prepared> {
  let photoPath = item.photoPath;
  let thumbPath = item.thumbPath;
  const stalePaths: string[] = [];
  let recompressed: Prepared["recompressed"];

  if (item.deletedAt) {
    stalePaths.push(...[photoPath, thumbPath].filter((path): path is string => Boolean(path)));
    photoPath = undefined;
    thumbPath = undefined;
  } else if (item.image && (item.photoDirty !== false || !item.photoPath)) {
    let full = dataUrlToBlob(item.image);
    let small = dataUrlToBlob(item.thumb ?? item.image);
    if (!UPLOADABLE.includes(full.type) || full.size > MAX_UPLOAD_BYTES) {
      recompressed = await recompressDataUrl(item.image);
      full = dataUrlToBlob(recompressed.image);
      small = dataUrlToBlob(recompressed.thumb);
    }
    // A fresh path per photo version tells other devices the photo changed.
    const base = `${userId()}/${item.id}/${Date.now().toString(36)}`;
    const nextPhoto = `${base}-full.${extension(full)}`;
    const nextThumb = `${base}-thumb.${extension(small)}`;
    await upload(nextPhoto, full);
    await upload(nextThumb, small);
    stalePaths.push(...[photoPath, thumbPath].filter((path): path is string => Boolean(path)));
    photoPath = nextPhoto;
    thumbPath = nextThumb;
  }
  return { item, row: toRow(item, photoPath ?? null, thumbPath ?? null), photoPath, thumbPath, recompressed, stalePaths };
}

async function pushItems() {
  const pending = (await loadItems()).filter(needsPush);
  for (let start = 0; start < pending.length; start += PUSH_BATCH) {
    const prepared: Prepared[] = [];
    for (const item of pending.slice(start, start + PUSH_BATCH)) prepared.push(await preparePush(item));
    const { data, error } = await client().from("items").upsert(prepared.map((entry) => entry.row)).select("id, synced_at");
    if (error) throw error;
    const syncedAt = new Map(data.map((row) => [row.id, row.synced_at]));
    for (const entry of prepared) await markPushed(entry, syncedAt.get(entry.item.id));
    const stale = prepared.flatMap((entry) => entry.stalePaths);
    // Best effort: a leftover file costs a little storage, never correctness.
    if (stale.length) await client().storage.from(PHOTO_BUCKET).remove(stale);
  }
}

// The user may have edited the piece while it was uploading, so only clear what was actually sent.
async function markPushed(entry: Prepared, remoteSyncedAt?: string) {
  const current = await getItem(entry.item.id);
  if (!current) return;
  const unchanged = current.updatedAt === entry.item.updatedAt;
  if (entry.item.deletedAt) {
    if (unchanged) await removeItem(current.id);
    return;
  }
  const samePhoto = current.image === entry.item.image;
  await saveItem({
    ...current,
    ...(samePhoto && entry.recompressed ? entry.recompressed : {}),
    photoPath: samePhoto ? entry.photoPath : current.photoPath,
    thumbPath: samePhoto ? entry.thumbPath : current.thumbPath,
    photoDirty: samePhoto ? false : current.photoDirty,
    dirty: !unchanged,
    remoteSyncedAt: unchanged ? remoteSyncedAt : current.remoteSyncedAt
  });
  dataChanged = true;
}

const extension = (blob: Blob) => (blob.type === "image/jpeg" ? "jpg" : "webp");

async function upload(path: string, blob: Blob) {
  const { error } = await client().storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: blob.type, upsert: true });
  if (error) throw error;
}

async function download(path: string) {
  const { data, error } = await client().storage.from(PHOTO_BUCKET).download(path);
  if (error) throw error;
  return blobToDataUrl(data);
}

/* ---------- Collections ---------- */

async function pullCollections() {
  let page = overlapStart(meta.collections);
  let list = (await loadMeta<Collection[]>("collections")) ?? [];
  let changed = false;
  for (;;) {
    let query = client().from("collections").select("*").eq("user_id", userId()).order("synced_at").order("id").limit(PAGE_SIZE);
    if (page) query = query.or(afterCursor(page));
    const { data, error } = await query;
    if (error) throw error;
    for (const row of data) {
      const next = applyRemoteCollection(list, row);
      if (next) {
        list = next;
        changed = true;
      }
    }
    if (data.length) {
      const last = data[data.length - 1];
      page = { at: last.synced_at, id: last.id };
      if (!meta.collections || last.synced_at > meta.collections.at) meta.collections = page;
    }
    if (data.length < PAGE_SIZE) break;
  }
  if (changed) {
    await saveMeta("collections", list);
    dataChanged = true;
  }
  await saveMeta("sync", meta);
}

function applyRemoteCollection(list: Collection[], row: CollectionRow): Collection[] | null {
  const index = list.findIndex((collection) => collection.id === row.id);
  if (row.deleted_at) return index >= 0 ? list.filter((_, position) => position !== index) : null;
  const remote: Collection = { id: row.id, name: row.name, position: row.position, updatedAt: Date.parse(row.updated_at), dirty: false };
  if (index >= 0) {
    const local = list[index];
    if (local.dirty !== false && local.updatedAt > remote.updatedAt) return null;
    return list.map((collection, position) => (position === index ? remote : collection));
  }
  // Each device starts with its own "Tops", "Bottoms"…; adopt the cloud's record for a name this device also has.
  const twin = list.findIndex((collection) => !collection.deletedAt && collection.name.toLowerCase() === row.name.toLowerCase());
  if (twin >= 0) return list.map((collection, position) => (position === twin ? remote : collection));
  return [...list, remote];
}

async function pushCollections() {
  const list = (await loadMeta<Collection[]>("collections")) ?? [];
  const pending = list.filter((collection) => collection.dirty !== false);
  if (!pending.length) return;
  const rows = pending.map((collection) => ({
    id: collection.id,
    user_id: userId(),
    name: collection.name,
    position: collection.position,
    updated_at: new Date(collection.updatedAt).toISOString(),
    deleted_at: collection.deletedAt ? new Date(collection.deletedAt).toISOString() : null
  }));
  const { error } = await client().from("collections").upsert(rows);
  if (error) {
    // Another device created the same name first: re-pull from scratch so the twin merge adopts it.
    if (error.code === "23505") {
      meta.collections = undefined;
      rerun = true;
      return;
    }
    throw error;
  }
  const sent = new Map(pending.map((collection) => [collection.id, collection.updatedAt]));
  const latest = (await loadMeta<Collection[]>("collections")) ?? [];
  const cleaned = latest
    .filter((collection) => !(collection.deletedAt && sent.get(collection.id) === collection.updatedAt))
    .map((collection) => (sent.get(collection.id) === collection.updatedAt ? { ...collection, dirty: false } : collection));
  await saveMeta("collections", cleaned);
  dataChanged = true;
}

/* ---------- Outfits and wear logs ---------- */

interface RecordSpec<S extends RecordStore, L extends Outfit | WearLog, R> {
  store: S;
  table: "outfits" | "wear_logs";
  fromRow: (row: R) => L;
  toRow: (record: L) => Record<string, unknown>;
}

const iso = (time: number) => new Date(time).toISOString();

const OUTFITS: RecordSpec<"outfits", Outfit, OutfitRow> = {
  store: "outfits",
  table: "outfits",
  fromRow: (row) => ({
    id: row.id,
    name: row.name,
    itemIds: row.item_ids,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
    dirty: false,
    remoteSyncedAt: row.synced_at
  }),
  toRow: (outfit) => ({
    id: outfit.id,
    user_id: userId(),
    name: outfit.name,
    item_ids: outfit.itemIds,
    created_at: iso(outfit.createdAt),
    updated_at: iso(outfit.updatedAt),
    deleted_at: outfit.deletedAt ? iso(outfit.deletedAt) : null
  })
};

const WEAR_LOGS: RecordSpec<"wearLogs", WearLog, WearLogRow> = {
  store: "wearLogs",
  table: "wear_logs",
  fromRow: (row) => ({
    id: row.id,
    wornOn: row.worn_on,
    itemIds: row.item_ids,
    outfitId: row.outfit_id ?? undefined,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
    dirty: false,
    remoteSyncedAt: row.synced_at
  }),
  toRow: (log) => ({
    id: log.id,
    user_id: userId(),
    worn_on: log.wornOn,
    item_ids: log.itemIds,
    outfit_id: log.outfitId ?? null,
    created_at: iso(log.createdAt),
    updated_at: iso(log.updatedAt),
    deleted_at: log.deletedAt ? iso(log.deletedAt) : null
  })
};

// The generated types can't follow a table name chosen at runtime, so these two tables go through an untyped view.
const looseClient = () => client() as unknown as SupabaseClient;

interface SyncedRow {
  id: string;
  synced_at: string;
  updated_at: string;
  deleted_at: string | null;
}

async function pullRecords<S extends RecordStore, L extends Outfit | WearLog, R>(spec: RecordSpec<S, L, R>) {
  let page = overlapStart(meta[spec.store]);
  for (;;) {
    let query = looseClient().from(spec.table).select("*").eq("user_id", userId()).order("synced_at").order("id").limit(PAGE_SIZE);
    if (page) query = query.or(afterCursor(page));
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as (SyncedRow & R)[];
    for (const row of rows) {
      const local = await getRecord(spec.store, row.id);
      if (local?.remoteSyncedAt === row.synced_at) continue;
      if (local && local.dirty !== false && local.updatedAt > Date.parse(row.updated_at)) continue;
      if (row.deleted_at) {
        if (local) {
          await removeRecord(spec.store, row.id);
          dataChanged = true;
        }
        continue;
      }
      await saveRecord(spec.store, spec.fromRow(row) as never);
      dataChanged = true;
    }
    if (rows.length) {
      const last = rows[rows.length - 1];
      page = { at: last.synced_at, id: last.id };
      const saved = meta[spec.store];
      if (!saved || last.synced_at > saved.at) meta[spec.store] = page;
      await saveMeta("sync", meta);
    }
    if (rows.length < PAGE_SIZE) return;
  }
}

async function pushRecords<S extends RecordStore, L extends Outfit | WearLog, R>(spec: RecordSpec<S, L, R>) {
  const pending = ((await loadRecords(spec.store)) as L[]).filter((record) => record.dirty !== false);
  for (let start = 0; start < pending.length; start += PUSH_BATCH) {
    const batch = pending.slice(start, start + PUSH_BATCH);
    const { data, error } = await looseClient().from(spec.table).upsert(batch.map(spec.toRow)).select("id, synced_at");
    if (error) throw error;
    const syncedAt = new Map((data as { id: string; synced_at: string }[]).map((row) => [row.id, row.synced_at]));
    for (const sent of batch) {
      const current = await getRecord(spec.store, sent.id);
      if (!current) continue;
      // Edited again while uploading: keep it marked so the next pass sends the newer version.
      const unchanged = current.updatedAt === sent.updatedAt;
      if (sent.deletedAt && unchanged) await removeRecord(spec.store, sent.id);
      else await saveRecord(spec.store, { ...current, dirty: !unchanged, remoteSyncedAt: unchanged ? syncedAt.get(sent.id) : current.remoteSyncedAt } as never);
      dataChanged = true;
    }
  }
}
