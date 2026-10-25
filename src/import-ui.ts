import { CHAT_IMPORT_MAX_BYTES, parseChatImport, type PreparedChatImportItem } from "./chat-import";
import { dataUrlToBlob, processPhoto } from "./photos";
import { loadItems, saveItems } from "./storage";
import { findExistingItemIds, getStatus, isSignedIn, onStatus, requestSync, syncNow } from "./sync";
import { UNKNOWN, type ClosetItem } from "./types";

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);

/** An ordinary file-import UI is also the bridge for photos prepared in chat. */
export function initChatImport(onImported: (count: number) => Promise<void>) {
  const dialog = document.querySelector<HTMLDialogElement>("#chatImportDialog")!;
  const form = document.querySelector<HTMLFormElement>("#chatImportForm")!;
  const input = document.querySelector<HTMLInputElement>("#chatImportFile")!;
  const save = document.querySelector<HTMLButtonElement>("#chatImportSave")!;
  const status = document.querySelector<HTMLElement>("#chatImportStatus")!;
  const preview = document.querySelector<HTMLElement>("#chatImportPreview")!;
  const error = document.querySelector<HTMLElement>("#chatImportError")!;
  let prepared: ClosetItem[] = [];
  let busy = false;
  let revision = 0;
  let settledStatus = "Details will stay Needs review until you confirm them.";

  function connectionProblem() {
    if (getStatus().state === "off") return "";
    if (!isSignedIn()) return "Sign in from Account first so these pieces can reach your private closet.";
    if (!navigator.onLine) return "Connect to the internet to check for pieces already in your closet.";
    return "";
  }

  function updateSave() {
    save.disabled = busy || !prepared.length || Boolean(connectionProblem());
    input.disabled = busy;
    if (!busy && dialog.open) status.textContent = connectionProblem() || settledStatus;
  }

  function showError(message: string) {
    error.textContent = message;
    error.hidden = !message;
  }

  onStatus(() => {
    if (dialog.open && !busy && connectionProblem()) status.textContent = connectionProblem();
    updateSave();
  });
  window.addEventListener("online", updateSave);
  window.addEventListener("offline", updateSave);

  document.addEventListener("click", (event) => {
    if (!(event.target as Element).closest("[data-chat-import]")) return;
    document.querySelector<HTMLDialogElement>("#addMenu")?.close();
    prepared = [];
    revision++;
    input.value = "";
    save.textContent = "Add to closet";
    preview.replaceChildren();
    showError("");
    settledStatus = "Details will stay Needs review until you confirm them.";
    status.textContent = connectionProblem() || settledStatus;
    updateSave();
    dialog.showModal();
  });
  dialog.addEventListener("click", (event) => {
    if (!busy && (event.target === dialog || (event.target as Element).closest("[data-close-import]"))) dialog.close();
  });
  dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { revision++; prepared = []; });

  async function preparePhoto(dataUrl: string) {
    const blob = dataUrlToBlob(dataUrl);
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const tooLarge = bitmap.width * bitmap.height > 40_000_000 || Math.max(bitmap.width, bitmap.height) > 10_000;
    bitmap.close();
    if (tooLarge) throw new Error("A photo is too large. Prepare it at 40 megapixels or less and try again.");
    const photo = await processPhoto(new File([blob], "import-photo", { type: blob.type }));
    if (dataUrlToBlob(photo.image).size > 2 * 1024 * 1024) throw new Error("A prepared photo exceeds the storage limit. Use a smaller source and try again.");
    return photo;
  }

  async function preparePiece(entry: PreparedChatImportItem): Promise<ClosetItem> {
    const front = await preparePhoto(entry.photos.front);
    const now = Date.now();
    const item: ClosetItem = {
      id: entry.id, name: entry.name, category: entry.category, brand: entry.brand ?? UNKNOWN,
      color: entry.color ?? UNKNOWN, size: entry.size, status: "Needs review", favorite: false,
      ...front, createdAt: now, updatedAt: now, dirty: true, photoDirty: true, importOnly: true,
    };
    if (entry.photos.label) Object.assign(item, { labelImage: (await preparePhoto(entry.photos.label)).image, labelDirty: true });
    if (entry.photos.back) Object.assign(item, { backImage: (await preparePhoto(entry.photos.back)).image, backDirty: true });
    if (entry.photos.render) {
      const studio = await preparePhoto(entry.photos.render);
      Object.assign(item, { renderImage: studio.image, renderThumb: studio.thumb, renderDirty: true, ai: entry.ai });
    }
    return item;
  }

  function renderPreview() {
    // Images have been decoded and re-encoded locally. Text is escaped; no remote content is loaded.
    preview.innerHTML = prepared.map((item) => `<article class="import-piece card"><div class="import-piece-photos"><figure><img src="${item.thumb}" alt="Original front of ${escape(item.name)}"><figcaption>Original</figcaption></figure>${item.renderThumb ? `<figure><img src="${item.renderThumb}" alt="AI-generated studio image of ${escape(item.name)}"><figcaption>AI-generated</figcaption></figure>` : ""}</div><h3>${escape(item.name)}</h3><p>${escape([item.category, item.brand, item.color, item.size].filter(Boolean).join(" · "))}</p><p>Needs review${item.labelImage ? " · Label photo included" : ""}${item.backImage ? " · Back photo included" : ""}</p></article>`).join("");
  }

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    const selectedRevision = ++revision;
    prepared = [];
    preview.replaceChildren();
    showError("");
    if (!file) { updateSave(); return; }
    busy = true;
    updateSave();
    status.textContent = "Checking your prepared pieces…";
    try {
      if (file.size > CHAT_IMPORT_MAX_BYTES) throw new Error("This file exceeds 30 MB. Prepare a smaller batch and try again.");
      const batch = await parseChatImport(await file.text());
      const next: ClosetItem[] = [];
      for (const [index, entry] of batch.items.entries()) {
        status.textContent = `Preparing ${index + 1} of ${batch.items.length} pieces…`;
        next.push(await preparePiece(entry));
      }
      if (selectedRevision !== revision || !dialog.open) return;
      prepared = next;
      renderPreview();
      settledStatus = `${prepared.length} ${prepared.length === 1 ? "piece is" : "pieces are"} ready. Originals and studio images will be saved separately.`;
    } catch (cause) {
      if (selectedRevision === revision) {
        settledStatus = "No pieces were added.";
        showError(cause instanceof Error ? cause.message : "Couldn’t read these photos. Prepare a new file and try again.");
      }
    } finally { busy = false; updateSave(); }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !prepared.length) return;
    showError("");
    const problem = connectionProblem();
    if (problem) { showError(problem); return; }
    busy = true;
    updateSave();
    let saved = false;
    try {
      const cloud = getStatus().state !== "off";
      const account = getStatus().email;
      if (cloud) {
        status.textContent = "Checking your private closet for duplicates…";
        await syncNow();
        if (getStatus().state !== "synced") throw new Error(getStatus().message || "Couldn’t check cloud backup. Try again when sync is working.");
      }
      const existing = new Set((await loadItems()).map((item) => item.id));
      if (cloud) for (const id of await findExistingItemIds(prepared.map((item) => item.id))) existing.add(id);
      if (cloud && (!isSignedIn() || getStatus().email !== account)) throw new Error("Your account changed. Reopen the import and try again.");
      const fresh = prepared.filter((item) => !existing.has(item.id));
      if (!fresh.length) {
        settledStatus = "These pieces were already imported or deleted. Your closet was left unchanged.";
        prepared = [];
        return;
      }
      await saveItems(fresh);
      saved = true;
      await onImported(fresh.length);
      prepared = [];
      preview.replaceChildren();
      input.value = "";
      if (cloud) {
        status.textContent = "Saved on this device. Syncing photos to your private closet…";
        await syncNow();
        if (getStatus().state !== "synced") {
          settledStatus = "Saved on this device. Check Account to finish cloud sync.";
          showError("Saved on this device. Cloud sync needs another try; your photos are kept safely here. Check Account for the sync error.");
          requestSync();
          return;
        }
      }
      settledStatus = cloud ? "Added and synced to your private closet." : "Added to this browser’s closet. Cloud backup is off in this version.";
      save.textContent = "Added";
    } catch (cause) {
      settledStatus = saved ? "Saved on this device. Check Account to finish cloud sync." : "No new pieces were added.";
      showError(cause instanceof Error ? cause.message : "Couldn’t import these pieces. Try again.");
    } finally { busy = false; updateSave(); }
  });
}
