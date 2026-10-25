// Run with: node --test tests/sync-media.test.mjs
// Transform the actual sync module; replace only storage/network/image boundaries.
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { transformWithOxc } from "vite";

const photo = (text) => `data:image/webp;base64,${Buffer.from(text).toString("base64")}`;
let records, uploads, removals, downloads, uploadFailure, upsertError, upsertRows, remoteRows, downloadHook;
let upserts;
const bucket = {
  upload: async (path) => {
    if (uploadFailure && path.includes(uploadFailure)) return { error: new Error("TEST upload failed") };
    uploads.push(path);
    return { error: null };
  },
  remove: async (paths) => { removals.push(...paths); return { error: null }; },
  download: async (path) => {
    downloads.push(path);
    await downloadHook?.();
    return { data: new Blob([path]), error: null };
  }
};
const query = {
  eq() { return this; },
  async in() { return { data: remoteRows, error: null }; }
};
globalThis.__mediaSyncTest = {
  supabase: {
    storage: { from: () => bucket },
    from: () => ({
      upsert: () => ({ select: async () => { upserts++; return { data: upsertRows, error: upsertError }; } }),
      select: () => query
    })
  },
  PHOTO_BUCKET: "closet-photos", UNKNOWN: "To identify",
  getItem: async (id) => structuredClone(records.get(id)),
  saveItem: async (item) => { records.set(item.id, structuredClone(item)); },
  removeItem: async (id) => { records.delete(id); },
  loadItems: async () => [...records.values()].map((item) => structuredClone(item)),
  dataUrlToBlob: (url) => new Blob([Buffer.from(url.split(",")[1], "base64")], { type: url.split(";")[0].slice(5) }),
  blobToDataUrl: async (blob) => photo(await blob.text()),
  recompressDataUrl: async () => ({ image: photo("encoded-full"), thumb: photo("480px-thumb") })
};
const dependencies = Object.keys(globalThis.__mediaSyncTest).join(",");
const source = (await readFile(new URL("../src/sync.ts", import.meta.url), "utf8")).replace(/^import .*;\r?\n/gm, "");
const { code } = await transformWithOxc(`const {${dependencies}}=globalThis.__mediaSyncTest;
${source}
export {applyRemoteItem,preparePush,markPushed,pushItems,needsPush};
export const setTestSession=()=>{session={user:{id:"00000000-0000-0000-0000-00000000000a"}};};`, "src/sync.ts");
const sync = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
delete globalThis.__mediaSyncTest;
sync.setTestSession();

const item = (id = "00000000-0000-0000-0000-000000000061") => ({
  id, name: "TEST ONLY", category: "Tops", brand: "Test", color: "Beige", status: "Needs review",
  favorite: false, createdAt: 1000, updatedAt: 1000, dirty: false,
  image: photo("front"), thumb: photo("thumb"), photoPath: "front", thumbPath: "thumb", photoDirty: false,
  labelImage: photo("label"), labelPath: "label", labelDirty: false,
  backImage: photo("back"), backPath: "back", backDirty: false,
  renderImage: photo("render"), renderThumb: photo("render-thumb"), renderPath: "render", renderThumbPath: "render-thumb", renderDirty: false
});
const row = (value) => ({
  id: value.id, user_id: "00000000-0000-0000-0000-00000000000a", name: value.name, category: "Tops",
  brand: "Test", color: "Beige", status: "needs_review", favorite: false,
  size: null, material: null, weather: null, occasions: null, price: null, purchased_on: null, store: null, care: null,
  photo_path: "front", thumb_path: "new-thumb", label_path: "label", back_path: "new-back",
  render_path: "render", render_thumb_path: "new-render-thumb", ai: null,
  created_at: new Date(1000).toISOString(), updated_at: new Date(2000).toISOString(),
  deleted_at: null, synced_at: "2026-10-25T00:00:00Z"
});
beforeEach(() => {
  records = new Map(); uploads = []; removals = []; downloads = []; upserts = 0;
  uploadFailure = undefined; upsertError = null; upsertRows = []; remoteRows = []; downloadHook = undefined;
});

test("media downloads follow each version independently and keep matching cached images", async () => {
  const original = item(); records.set(original.id, original);
  await sync.applyRemoteItem(row(original));
  assert.deepEqual(downloads.sort(), ["new-back", "new-render-thumb", "new-thumb"].sort());
  const saved = records.get(original.id);
  for (const key of ["image", "labelImage", "renderImage"]) assert.equal(saved[key], original[key]);
});

test("reference upload and render removal preserve original media paths", async () => {
  const value = { ...item(), dirty: true, labelDirty: true, labelPath: undefined,
    renderImage: undefined, renderThumb: undefined, renderDirty: true };
  const entry = await sync.preparePush(value);
  assert.equal(entry.row.photo_path, "front"); assert.equal(entry.row.thumb_path, "thumb");
  assert.equal(entry.row.render_path, null); assert.equal(entry.row.render_thumb_path, null);
  assert.deepEqual(entry.stalePaths, ["render", "render-thumb"]);
  assert.equal(uploads.length, 1); assert.match(uploads[0], /-label.webp$/);
});

test("render upload makes a 480px thumbnail and retains concurrent image edits", async () => {
  const entry = await sync.preparePush({ ...item(), dirty: true, renderDirty: true });
  assert.equal(uploads.length, 2); assert.match(entry.row.render_thumb_path, /-render-thumb.webp$/);
  assert.equal(entry.media.find(({ spec }) => spec.kind === "render").recompressed.thumb, photo("480px-thumb"));
  records.set(entry.item.id, { ...entry.item, updatedAt: 3000, renderImage: photo("replacement"), renderDirty: true, importOnly: true });
  await sync.markPushed(entry, "new-synced");
  const saved = records.get(entry.item.id);
  assert.equal(saved.renderImage, photo("replacement")); assert.equal(saved.renderPath, "render");
  assert.equal(saved.renderDirty, true); assert.equal(saved.dirty, true); assert.equal(saved.importOnly, undefined);
});

test("deletion cleans every media path and an in-flight first-import Undo survives", async () => {
  const value = { ...item(), dirty: true, deletedAt: 4000, updatedAt: 4000, importOnly: true };
  const entry = await sync.preparePush(value);
  assert.equal(entry.stalePaths.length, 6); assert.equal(uploads.length, 0);
  for (const key of ["photo_path", "thumb_path", "label_path", "back_path", "render_path", "render_thumb_path"]) assert.equal(entry.row[key], null);
  records.set(value.id, { ...item(), dirty: true, updatedAt: 5000, importOnly: true,
    photoDirty: true, labelDirty: true, backDirty: true, renderDirty: true });
  await sync.markPushed(entry, "deleted");
  const restored = records.get(value.id);
  assert.equal(restored.deletedAt, undefined); assert.equal(restored.dirty, true);
  assert.equal(restored.renderDirty, true); assert.equal(restored.importOnly, undefined);
});

test("an edit made during downloads is retained and media flags stay pending", async () => {
  const original = item(); records.set(original.id, original);
  downloadHook = async () => records.set(original.id, { ...original, name: "TEST edited", updatedAt: 4000, dirty: true });
  await sync.applyRemoteItem(row(original));
  assert.equal(records.get(original.id).name, "TEST edited");
  assert.equal(sync.needsPush({ ...original, dirty: false, labelDirty: true }), true);
});

test("a later preparation failure cleans earlier uploads before any row is sent", async () => {
  for (const id of ["00000000-0000-0000-0000-000000000061", "00000000-0000-0000-0000-000000000062"]) {
    records.set(id, { ...item(id), dirty: true, labelDirty: true });
  }
  uploadFailure = "00000000-0000-0000-0000-000000000062";
  await assert.rejects(sync.pushItems(), /TEST upload failed/);
  assert.equal(upserts, 0); assert.equal(uploads.length, 1); assert.deepEqual(removals, uploads);
  assert.equal(records.size, 2);
});

test("an ambiguous upsert failure keeps uploaded files that the cloud may reference", async () => {
  const value = { ...item(), dirty: true, labelDirty: true }; records.set(value.id, value);
  upsertError = new Error("TEST lost response");
  await assert.rejects(sync.pushItems(), /TEST lost response/);
  assert.equal(uploads.length, 1); assert.deepEqual(removals, []);
  assert.equal(records.get(value.id).dirty, true);
});

test("insert-only conflict discards unused uploads and preserves the cloud tombstone", async () => {
  const value = { ...item(), dirty: true, importOnly: true, labelDirty: true }; records.set(value.id, value);
  remoteRows = [{ ...row(value), deleted_at: new Date(2000).toISOString() }];
  await sync.pushItems();
  assert.equal(upserts, 1); assert.deepEqual(removals, uploads); assert.equal(records.size, 0);
});
