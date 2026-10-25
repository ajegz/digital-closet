// Local-first sync with Supabase (docs/phase-3-plan.md).
// IndexedDB stays the source of truth on the device; this module pulls the cloud's changes,
// then pushes local ones. Conflicts resolve by the newest updated_at (last write wins).
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";
import { blobToDataUrl, dataUrlToBlob, recompressDataUrl } from "./photos";
import { clearAll, getItem, getRecord, loadItems, loadMeta, loadRecords, removeItem, removeRecord, saveItem, saveMeta, saveRecord, type RecordStore } from "./storage";
import { PHOTO_BUCKET, supabase } from "./supabase";
import { UNKNOWN, type ClosetItem, type Collection, type ItemAI, type Occasion, type Outfit, type WearLog, type Weather } from "./types";

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

/** Checks stable chat-import ids, including cloud tombstones; RLS still applies. */
export async function findExistingItemIds(ids: string[]): Promise<Set<string>> {
  if (ids.length > 10) throw new Error("Check at most 10 imported pieces at a time.");
  if (!ids.length) return new Set();
  if (ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error("An imported piece has an invalid id.");
  }
  const { data, error } = await client().from("items").select("id").eq("user_id", userId()).in("id", ids);
  if (error) throw error;
  return new Set(data.map((row) => row.id));
}

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
  const message = error instanceof Error ? error.message : (error as { message?: unknown } | null)?.message;
  const text = typeof message === "string" ? message : String(error);
  if (/column|schema cache/i.test(text) && /label_path|back_path|render_path|render_thumb_path|\bai\b/i.test(text)) {
    return "Cloud backup needs the chat-import database update. Your changes are still saved on this device.";
  }
  return text;
}

function isNetworkError(error: unknown) {
  return !navigator.onLine || /failed to fetch|networkerror|load failed|fetch failed/i.test(describe(error));
}

const needsPush = (item: ClosetItem) => !item.sample && (item.dirty !== false
  || item.photoDirty === true || item.labelDirty === true || item.backDirty === true || item.renderDirty === true);

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

// Explicit columns detect an unapplied migration before any additional photos are uploaded.
const ITEM_COLUMNS = "id,user_id,name,category,brand,color,status,favorite,size,material,weather,occasions,price,purchased_on,store,care,photo_path,thumb_path,label_path,back_path,render_path,render_thumb_path,ai,created_at,updated_at,deleted_at,synced_at";

type MediaKind = "photo" | "label" | "back" | "render";
type ImageKey = "image" | "thumb" | "labelImage" | "backImage" | "renderImage" | "renderThumb";
type PathKey = "photoPath" | "thumbPath" | "labelPath" | "backPath" | "renderPath" | "renderThumbPath";
type DirtyKey = "photoDirty" | "labelDirty" | "backDirty" | "renderDirty";
interface MediaSpec {
  kind: MediaKind;
  image: ImageKey;
  thumb?: ImageKey;
  path: PathKey;
  thumbPath?: PathKey;
  dirty: DirtyKey;
  column: "photo_path" | "label_path" | "back_path" | "render_path";
  thumbColumn?: "thumb_path" | "render_thumb_path";
}
const MEDIA: readonly MediaSpec[] = [
  { kind: "photo", image: "image", thumb: "thumb", path: "photoPath", thumbPath: "thumbPath", dirty: "photoDirty", column: "photo_path", thumbColumn: "thumb_path" },
  { kind: "label", image: "labelImage", path: "labelPath", dirty: "labelDirty", column: "label_path" },
  { kind: "back", image: "backImage", path: "backPath", dirty: "backDirty", column: "back_path" },
  { kind: "render", image: "renderImage", thumb: "renderThumb", path: "renderPath", thumbPath: "renderThumbPath", dirty: "renderDirty", column: "render_path", thumbColumn: "render_thumb_path" }
];
type CachedMedia = Partial<Pick<ClosetItem, ImageKey>>;

async function pullItems() {
  let page = overlapStart(meta.items);
  for (;;) {
    let query = client().from("items").select(ITEM_COLUMNS).eq("user_id", userId()).order("synced_at").order("id").limit(PAGE_SIZE);
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
  if (local && !local.importOnly && needsPush(local) && local.updatedAt >= Date.parse(row.updated_at)) return;
  if (row.deleted_at) {
    if (local) {
      await removeItem(row.id);
      dataChanged = true;
    }
    return;
  }
  const images: CachedMedia = {};
  await Promise.all(MEDIA.map(async (spec) => {
    images[spec.image] = await cachedDownload(row[spec.column], local?.[spec.path], local?.[spec.image]);
    if (spec.thumb && spec.thumbPath && spec.thumbColumn) {
      images[spec.thumb] = await cachedDownload(
        row[spec.thumbColumn] ?? row[spec.column],
        local?.[spec.thumbPath] ?? local?.[spec.path],
        local?.[spec.thumb] ?? local?.[spec.image]
      );
    }
  }));
  // A long download must not overwrite an edit made while the request was in flight.
  const latest = await getItem(row.id);
  if (latest && !latest.importOnly && needsPush(latest) && latest.updatedAt >= Date.parse(row.updated_at)) return;
  await saveItem(fromRow(row, images));
  dataChanged = true;
}

async function cachedDownload(path: string | null, cachedPath?: string, cachedImage?: string) {
  if (!path) return undefined;
  return path === cachedPath && cachedImage ? cachedImage : download(path);
}

function fromRow(row: ItemRow, images: CachedMedia): ClosetItem {
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
    ...images,
    ai: row.ai === null ? undefined : row.ai as unknown as ItemAI,
    photoPath: row.photo_path ?? undefined,
    thumbPath: row.thumb_path ?? undefined,
    labelPath: row.label_path ?? undefined,
    backPath: row.back_path ?? undefined,
    renderPath: row.render_path ?? undefined,
    renderThumbPath: row.render_thumb_path ?? undefined,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
    dirty: false,
    photoDirty: false,
    labelDirty: false,
    backDirty: false,
    renderDirty: false,
    remoteSyncedAt: row.synced_at
  };
}

function toRow(item: ClosetItem, paths: Partial<Pick<ClosetItem, PathKey>>): ItemInsert {
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
    photo_path: paths.photoPath ?? null,
    thumb_path: paths.thumbPath ?? null,
    label_path: paths.labelPath ?? null,
    back_path: paths.backPath ?? null,
    render_path: paths.renderPath ?? null,
    render_thumb_path: paths.renderThumbPath ?? null,
    ai: item.ai ? item.ai as unknown as Json : null,
    created_at: iso(item.createdAt),
    updated_at: iso(item.updatedAt),
    deleted_at: item.deletedAt ? iso(item.deletedAt) : null
  };
}

interface PreparedMedia {
  spec: MediaSpec;
  path?: string;
  thumbPath?: string;
  /** Re-encoded media, kept only if the user hasn't replaced this image meanwhile. */
  recompressed?: { image: string; thumb: string };
}

interface Prepared {
  item: ClosetItem;
  row: ItemInsert;
  media: PreparedMedia[];
  /** Old versions to delete only after the row no longer points at them. */
  stalePaths: string[];
  /** Fresh files can be removed if insert-only conflict handling skips this import. */
  uploadedPaths: string[];
}

async function preparePush(item: ClosetItem): Promise<Prepared> {
  const stalePaths: string[] = [];
  const uploadedPaths: string[] = [];
  const media: PreparedMedia[] = [];
  const paths: Partial<Pick<ClosetItem, PathKey>> = {};
  try {
    for (const spec of MEDIA) {
      let path = item[spec.path];
      let thumbPath = spec.thumbPath ? item[spec.thumbPath] : undefined;
      let recompressed: PreparedMedia["recompressed"];
      const image = item[spec.image];
      if (item.deletedAt || (!image && item[spec.dirty] === true)) {
        stalePaths.push(...[path, thumbPath].filter((value): value is string => Boolean(value)));
        path = undefined;
        thumbPath = undefined;
      } else if (image && (item[spec.dirty] !== false || !path)) {
        let full = dataUrlToBlob(image);
        let small = spec.thumb ? dataUrlToBlob(item[spec.thumb] ?? image) : undefined;
        // Always make the generated view's thumbnail with the shared 480px encoder.
        if (spec.kind === "render" || !isUploadable(full) || (small && (!isUploadable(small) || !item[spec.thumb!]))) {
          recompressed = await recompressDataUrl(image);
          full = dataUrlToBlob(recompressed.image);
          small = spec.thumb ? dataUrlToBlob(recompressed.thumb) : undefined;
        }
        if (!isUploadable(full) || (small && !isUploadable(small))) {
          throw new Error("This photo is still too large to back up. Choose a smaller photo and try again.");
        }
        // A UUID avoids collisions between media versions uploaded by different devices.
        const base = `${userId()}/${item.id}/${crypto.randomUUID()}`;
        const suffix = spec.kind === "photo" ? "full" : spec.kind;
        const nextPath = `${base}-${suffix}.${extension(full)}`;
        await upload(nextPath, full);
        uploadedPaths.push(nextPath);
        let nextThumb: string | undefined;
        if (small) {
          nextThumb = `${base}-${spec.kind === "render" ? "render-thumb" : "thumb"}.${extension(small)}`;
          await upload(nextThumb, small);
          uploadedPaths.push(nextThumb);
        }
        stalePaths.push(...[path, thumbPath].filter((value): value is string => Boolean(value)));
        path = nextPath;
        thumbPath = nextThumb;
      }
      media.push({ spec, path, thumbPath, recompressed });
      paths[spec.path] = path;
      if (spec.thumbPath) paths[spec.thumbPath] = thumbPath;
    }
  } catch (error) {
    // No row has been sent yet, so these incomplete uploads are safe to remove.
    await cleanUnusedUploads(uploadedPaths);
    throw error;
  }
  return { item, row: toRow(item, paths), media, stalePaths, uploadedPaths };
}

const isUploadable = (blob: Blob) => UPLOADABLE.includes(blob.type) && blob.size <= MAX_UPLOAD_BYTES;

async function cleanUnusedUploads(paths: string[]) {
  if (!paths.length) return;
  try {
    await client().storage.from(PHOTO_BUCKET).remove(paths);
  } catch {
    // Cleanup is best effort; preserve the original error and all local changes.
  }
}

async function pushItems() {
  const pending = (await loadItems()).filter(needsPush);
  for (let start = 0; start < pending.length; start += PUSH_BATCH) {
    const prepared: Prepared[] = [];
    try {
      for (const item of pending.slice(start, start + PUSH_BATCH)) prepared.push(await preparePush(item));
    } catch (error) {
      // None of this batch's rows were sent, including the already-prepared entries.
      await cleanUnusedUploads(prepared.flatMap((entry) => entry.uploadedPaths));
      throw error;
    }
    // Insert-only imports cannot revive a tombstone or overwrite a piece imported elsewhere.
    for (const importOnly of [false, true]) {
      const group = prepared.filter((entry) => Boolean(entry.item.importOnly) === importOnly);
      if (!group.length) continue;
      const { data, error } = await client().from("items").upsert(group.map((entry) => entry.row), {
        onConflict: "id", ignoreDuplicates: importOnly
      }).select("id, synced_at");
      // An error response can arrive after a commit. Keep fresh files in that case:
      // deleting them blindly could break a row the server successfully saved.
      if (error) throw error;
      const syncedAt = new Map(data.map((row) => [row.id, row.synced_at]));
      const sent = group.filter((entry) => syncedAt.has(entry.item.id));
      for (const entry of sent) await markPushed(entry, syncedAt.get(entry.item.id));
      const skipped = group.filter((entry) => !syncedAt.has(entry.item.id));
      const stale = [...new Set([
        ...sent.flatMap((entry) => entry.stalePaths),
        ...skipped.flatMap((entry) => entry.uploadedPaths)
      ])];
      // Best effort: a leftover file costs a little storage, never correctness.
      if (stale.length) await client().storage.from(PHOTO_BUCKET).remove(stale);
      if (skipped.length) {
        const { data: existing, error: readError } = await client().from("items").select(ITEM_COLUMNS)
          .eq("user_id", userId()).in("id", skipped.map((entry) => entry.item.id));
        if (readError) throw readError;
        for (const row of existing) await applyRemoteItem(row);
        if (existing.length !== skipped.length) {
          throw new Error("An imported piece has an id already in use. Import a fresh package; your local changes are still saved.");
        }
      }
    }
  }
}

// The user may have edited the piece while it was uploading, so only clear what was actually sent.
async function markPushed(entry: Prepared, remoteSyncedAt?: string) {
  const current = await getItem(entry.item.id);
  if (!current) return;
  // Comparing the snapshot also catches distinct edits made in the same millisecond.
  const unchanged = current.updatedAt === entry.item.updatedAt && JSON.stringify(current) === JSON.stringify(entry.item);
  if (entry.item.deletedAt) {
    if (unchanged) {
      await removeItem(current.id);
      dataChanged = true;
    } else if (current.importOnly) {
      // The first insert succeeded: a concurrent Undo must now use normal upsert,
      // rather than treating this just-created cloud tombstone as a duplicate.
      await saveItem({ ...current, importOnly: undefined });
      dataChanged = true;
    }
    return;
  }
  const next = { ...current };
  for (const { spec, path, thumbPath, recompressed } of entry.media) {
    const sameMedia = current[spec.image] === entry.item[spec.image]
      && (!spec.thumb || current[spec.thumb] === entry.item[spec.thumb]);
    if (!sameMedia) continue;
    if (recompressed) {
      next[spec.image] = recompressed.image;
      if (spec.thumb) next[spec.thumb] = recompressed.thumb;
    }
    next[spec.path] = path;
    if (spec.thumbPath) next[spec.thumbPath] = thumbPath;
    next[spec.dirty] = false;
  }
  next.dirty = !unchanged;
  next.importOnly = undefined;
  next.remoteSyncedAt = unchanged ? remoteSyncedAt : current.remoteSyncedAt;
  await saveItem(next);
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
