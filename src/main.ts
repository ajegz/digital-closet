import "./styles.css";
import { icons, type IconName } from "./icons";
import { loadItems, loadMeta, removeItem, saveItem, saveMeta } from "./storage";
import type { ClosetItem, Garment, Status } from "./types";

type Tab = "closet" | "favorites" | "recent" | "collections";
type EmptyAction = "add" | "reset" | "closet";

const DEFAULT_CATEGORIES = ["Tops", "Bottoms", "Outerwear", "Dresses", "Accessories"];
const UNKNOWN = "To identify";
const RECENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const XP_PER_LEVEL = 100;
const QUEST_TARGET = 3;
const TOAST_MS = 5000;
const COLLECTION_COLORS = ["var(--leaf)", "var(--sky)", "var(--grape)", "var(--flame)", "var(--berry)", "var(--sun-ledge)"];
const TAB_TITLES: Record<Tab, string> = { closet: "Closet", favorites: "Favorites", recent: "Recent", collections: "Collections" };

// Shown only while the closet is empty so the first screen isn't blank. Never saved.
const sampleItems: ClosetItem[] = [
  { id: "sample-tee", name: "Essential cotton tee", category: "Tops", brand: "Sample piece", color: "Ink black", status: "Needs review", garment: "tee", favorite: false, createdAt: 0, updatedAt: 0, sample: true },
  { id: "sample-shirt", name: "Relaxed overshirt", category: "Tops", brand: "Sample piece", color: "Leaf green", status: "Needs review", garment: "shirt", favorite: false, createdAt: 0, updatedAt: 0, sample: true },
  { id: "sample-pants", name: "Wide-leg trousers", category: "Bottoms", brand: "Sample piece", color: "Denim blue", status: "Needs review", garment: "pants", favorite: false, createdAt: 0, updatedAt: 0, sample: true },
  { id: "sample-coat", name: "Everyday chore coat", category: "Outerwear", brand: "Sample piece", color: "Rust orange", status: "Needs review", garment: "coat", favorite: false, createdAt: 0, updatedAt: 0, sample: true }
];

let items: ClosetItem[] = [];
let categories = [...DEFAULT_CATEGORIES];
let activityDays: string[] = [];
let tab: Tab = "closet";
let activeCategory = "all";
let activeStatus = "all";
let layout: "grid" | "list" = "grid";
let editingId: string | null = null;
let previewUrl: string | null = null;
let toastTimer: number | undefined;

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

const grid = $<HTMLDivElement>("#itemGrid");
const searchInput = $<HTMLInputElement>("#searchInput");
const itemDialog = $<HTMLDialogElement>("#itemDialog");
const itemForm = $<HTMLFormElement>("#itemForm");
const photoInput = $<HTMLInputElement>("#photoInput");
const categorySelect = $<HTMLSelectElement>("#categorySelect");
const collectionForm = $<HTMLFormElement>("#collectionForm");
const collectionInput = $<HTMLInputElement>("#collectionInput");
const toast = $<HTMLDivElement>("#toast");

/* ---------- Helpers ---------- */

const htmlEscapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" };

function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>'"]/g, (char) => htmlEscapes[char]);
}

const known = (value: string) => Boolean(value) && value !== UNKNOWN;
const pad = (value: number) => String(value).padStart(2, "0");
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const collectionHash = (name: string) => `#collection-${encodeURIComponent(name)}`;
const collectionColor = (name: string) => COLLECTION_COLORS[Math.max(categories.indexOf(name), 0) % COLLECTION_COLORS.length];

function newId() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function dayKey(time = Date.now()) {
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function relativeDay(time: number) {
  const startOfDay = (value: number) => new Date(value).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDay(Date.now()) - startOfDay(time)) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function garmentFor(category: string): Garment {
  if (category === "Bottoms") return "pants";
  if (category === "Outerwear") return "coat";
  return "tee";
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function persist(task: Promise<unknown>) {
  try {
    await task;
  } catch (error) {
    console.error(error);
    showToast({ kind: "error", title: "Couldn’t save", message: "This browser blocked storage. Recent changes may be lost on refresh." });
  }
}

/* ---------- Game loop (see duolingo-style skill §5) ---------- */

function itemXp(item: ClosetItem) {
  let xp = 10;
  if (item.image) xp += 5;
  if (known(item.brand) && known(item.color)) xp += 5;
  if (item.status === "Confirmed") xp += 5;
  return xp;
}

const totalXp = () => items.reduce((sum, item) => sum + itemXp(item), 0);
const levelFor = (xp: number) => Math.floor(xp / XP_PER_LEVEL) + 1;
const questProgress = () => items.filter((item) => item.image && dayKey(item.createdAt) === dayKey()).length;

function currentStreak() {
  const days = new Set(activityDays);
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  // A streak stays alive until the end of the day after the last activity.
  if (!days.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function recordActivity() {
  const today = dayKey();
  if (activityDays.includes(today)) return;
  activityDays = [...activityDays, today].slice(-400);
  void persist(saveMeta("activityDays", activityDays));
}

/* ---------- Routing ---------- */

function applyHash(hash: string) {
  // Back/forward while the sheet is open should leave the sheet, like a native app.
  if (itemDialog.open) itemDialog.close();
  if (hash.startsWith("#collection-")) {
    const name = decodeURIComponent(hash.slice("#collection-".length));
    tab = "closet";
    activeCategory = categories.includes(name) ? name : "all";
  } else {
    const name = hash.slice(1);
    tab = name === "favorites" || name === "recent" || name === "collections" ? name : "closet";
    activeCategory = "all";
  }
  render();
}

/* ---------- Rendering ---------- */

function visibleItems() {
  const query = searchInput.value.trim().toLowerCase();
  const recentCutoff = Date.now() - RECENT_DAYS * DAY_MS;
  return (items.length ? items : sampleItems)
    .filter((item) => {
      if (tab === "favorites" && !item.favorite) return false;
      if (tab === "recent" && item.createdAt < recentCutoff) return false;
      const matchesText = [item.name, item.category, item.brand, item.color].join(" ").toLowerCase().includes(query);
      const matchesCategory = activeCategory === "all" || item.category === activeCategory;
      const matchesStatus = activeStatus === "all" || item.status === activeStatus;
      return matchesText && matchesCategory && matchesStatus;
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function cardHtml(item: ClosetItem) {
  const visual = item.image
    ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy">`
    : `<div class="sample-garment ${item.garment ?? garmentFor(item.category)}" aria-hidden="true"></div>`;
  const heart = item.sample
    ? `<span class="tag">Sample</span>`
    : `<button class="heart-button${item.favorite ? " is-on" : ""}" data-favorite type="button" aria-pressed="${item.favorite}" aria-label="Favorite ${escapeHtml(item.name)}">${item.favorite ? icons.heartFilled : icons.heart}</button>`;
  const meta = [item.brand, item.color].filter(known).join(" · ") || item.category;
  const status = item.status === "Confirmed" ? `<span class="status-pill is-ok">Confirmed</span>` : `<span class="status-pill">Needs review</span>`;
  const label = item.sample ? "Sample piece. Add your own" : `Edit ${item.name}`;
  return `
    <article class="item-card${item.sample ? " is-sample" : ""}" data-id="${escapeHtml(item.id)}">
      <div class="item-visual">${visual}</div>
      ${heart}
      <div class="item-body"><h3><button class="item-link" type="button" aria-label="${escapeHtml(label)}">${escapeHtml(item.name)}</button></h3><p class="item-meta">${escapeHtml(meta)}</p>${status}</div>
    </article>`;
}

function emptyState(): { title: string; text: string; action: EmptyAction } {
  if (searchInput.value.trim() || activeStatus !== "all") return { title: "No pieces match", text: "Try another search or clear the filters.", action: "reset" };
  if (tab === "favorites") return { title: "No favorites yet", text: "Tap the heart on any piece to keep it here.", action: "closet" };
  if (tab === "recent") return { title: "Nothing new lately", text: `Pieces you add show up here for ${RECENT_DAYS} days.`, action: "add" };
  if (activeCategory !== "all") return { title: `${activeCategory} is empty`, text: `Add a piece and file it under ${activeCategory}.`, action: "add" };
  return { title: "Your closet is empty", text: "Add your first piece to get started.", action: "add" };
}

const EMPTY_ACTION_LABELS: Record<EmptyAction, string> = { add: "Add a piece", reset: "Clear filters", closet: "Browse closet" };

function render() {
  const onCollections = tab === "collections";
  $("#closetScreen").hidden = onCollections;
  $("#collectionsScreen").hidden = !onCollections;
  $("#dashboard").hidden = tab !== "closet" || activeCategory !== "all";
  $("#screenTitle").textContent = TAB_TITLES[tab];
  document.querySelectorAll<HTMLAnchorElement>(".tab").forEach((link) => {
    if (link.dataset.tab === tab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  renderStats();
  if (onCollections) renderCollections();
  else renderCatalog();
}

function renderCatalog() {
  const visible = visibleItems();
  const title = tab === "favorites" ? "Favorites" : tab === "recent" ? "Recently added" : activeCategory === "all" ? "All items" : activeCategory;
  $("#viewTitle").textContent = title;
  $("#visibleCount").textContent = String(visible.length);

  $("#categoryFilters").innerHTML = ["all", ...categories]
    .map((name) => `<button class="chip${name === activeCategory ? " is-on" : ""}" data-category="${escapeHtml(name)}" type="button" aria-pressed="${name === activeCategory}">${name === "all" ? "All" : escapeHtml(name)}</button>`)
    .join("");

  grid.classList.toggle("is-list", layout === "list");
  grid.innerHTML = visible.map(cardHtml).join("");

  const empty = $("#emptyState");
  empty.hidden = visible.length > 0;
  if (!visible.length) {
    const state = emptyState();
    $("#emptyTitle").textContent = state.title;
    $("#emptyText").textContent = state.text;
    const action = $<HTMLButtonElement>("#emptyAction");
    action.textContent = EMPTY_ACTION_LABELS[state.action];
    action.dataset.action = state.action;
  }
}

function renderStats() {
  const count = items.length;
  const xp = totalXp();
  const level = levelFor(xp);
  const levelXp = xp % XP_PER_LEVEL;
  const streak = currentStreak();
  const quest = Math.min(questProgress(), QUEST_TARGET);

  $("#todayLabel").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  $("#greeting").textContent = count ? `${plural(count, "piece")} and counting` : "Let’s fill your closet";
  $("#levelBadge").textContent = `Lv ${level}`;
  $("#xpBar").style.width = `${levelXp}%`;
  $("#xpToNext").textContent = `${levelXp} / ${XP_PER_LEVEL} XP to level ${level + 1}`;

  $("#xpCount").textContent = String(xp);
  $("#xpPill").setAttribute("aria-label", `${xp} XP, level ${level}`);
  $("#streakCount").textContent = String(streak);
  const streakPill = $("#streakPill");
  streakPill.classList.toggle("is-cold", streak === 0);
  streakPill.setAttribute("aria-label", streak ? `${streak}-day streak` : "No streak yet. Add a piece to start one");

  $("#questBar").style.width = `${(quest / QUEST_TARGET) * 100}%`;
  $("#questCount").textContent = `${quest}/${QUEST_TARGET}`;
  $("#questTitle").textContent = quest >= QUEST_TARGET ? "Quest complete. See you tomorrow!" : `Add ${QUEST_TARGET} pieces with photos`;
  document.querySelector(".quest-card")?.classList.toggle("is-done", quest >= QUEST_TARGET);

  const withPhotos = items.filter((item) => item.image).length;
  const latest = Math.max(0, ...items.map((item) => item.updatedAt));
  $("#itemStat").textContent = String(count);
  $("#missingStat").textContent = String(items.filter((item) => item.status === "Needs review").length);
  $("#photoStat").textContent = `${count ? Math.round((withPhotos / count) * 100) : 0}%`;
  $("#lastUpdatedStat").textContent = latest ? relativeDay(latest) : "—";
}

function renderCollections() {
  $("#collectionGrid").innerHTML = categories
    .map((name) => {
      const count = items.filter((item) => item.category === name).length;
      return `<a class="collection-tile" href="${collectionHash(name)}"><span class="collection-swatch" style="--swatch:${collectionColor(name)}">${icons.hanger}</span><span class="collection-name">${escapeHtml(name)}</span><span class="collection-count">${plural(count, "piece")}</span></a>`;
    })
    .join("") + `<button class="collection-tile is-new" data-new-collection type="button">${icons.plus}<span class="collection-name">New collection</span></button>`;
}

function renderCategoryOptions(selected: string) {
  categorySelect.innerHTML = categories.map((name) => `<option${name === selected ? " selected" : ""}>${escapeHtml(name)}</option>`).join("");
}

/* ---------- Feedback banner ---------- */

interface ToastOptions {
  kind?: "success" | "error" | "info";
  title: string;
  message: string;
  xp?: number;
  action?: { label: string; run: () => void };
}

function showToast({ kind = "success", title, message, xp, action }: ToastOptions) {
  window.clearTimeout(toastTimer);
  toast.hidden = true;
  toast.className = `toast${kind === "success" ? "" : ` is-${kind}`}`;
  $("#toastIcon").innerHTML = kind === "success" ? icons.hangie : "";
  $("#toastTitle").textContent = title;
  $("#toastMessage").textContent = message;
  const xpChip = $("#toastXp");
  xpChip.hidden = !xp;
  xpChip.textContent = xp ? `+${xp} XP` : "";
  const button = $<HTMLButtonElement>("#toastAction");
  button.hidden = !action;
  button.textContent = action?.label ?? "";
  button.onclick = action ? () => { action.run(); toast.hidden = true; } : null;
  // Re-showing restarts the slide-up animation.
  void toast.offsetWidth;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, TOAST_MS);
}

function bumpStats() {
  ["#xpPill", "#streakPill"].forEach((selector) => {
    const pill = $(selector);
    pill.classList.remove("is-bump");
    void pill.offsetWidth;
    pill.classList.add("is-bump");
  });
}

/* ---------- Add / edit sheet ---------- */

function formField<T extends HTMLInputElement | HTMLSelectElement = HTMLInputElement>(name: string) {
  return itemForm.elements.namedItem(name) as T;
}

function setPhotoPreview(src?: string) {
  const preview = $<HTMLImageElement>("#photoPreview");
  preview.hidden = !src;
  if (src) preview.src = src;
  else preview.removeAttribute("src");
  $("#uploadZone").classList.toggle("has-photo", Boolean(src));
  $("#uploadTitle").textContent = src ? "Change photo" : "Add a photo";
}

function clearPreviewUrl() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

function openItemDialog(item?: ClosetItem) {
  editingId = item?.id ?? null;
  itemForm.reset();
  clearPreviewUrl();
  renderCategoryOptions(item?.category ?? (activeCategory !== "all" ? activeCategory : categories[0]));
  formField("name").value = item?.name ?? "";
  formField("brand").value = item && known(item.brand) ? item.brand : "";
  formField("color").value = item && known(item.color) ? item.color : "";
  (itemForm.elements.namedItem("status") as RadioNodeList).value = item?.status ?? "Needs review";
  setPhotoPreview(item?.image);
  $("#dialogEyebrow").textContent = item ? "Edit piece" : "New piece";
  $("#dialogTitle").textContent = item ? "Refine the details" : "Bring in a piece";
  $("#saveItemButton").textContent = item ? "Save changes" : "Add to closet";
  $("#deleteItemButton").hidden = !item;
  itemDialog.showModal();
}

async function saveFromForm() {
  const formData = new FormData(itemForm);
  const field = (name: string) => String(formData.get(name) ?? "").trim();
  const file = photoInput.files?.[0];
  const existing = items.find((entry) => entry.id === editingId);
  const xpBefore = totalXp();
  const questBefore = questProgress();
  const now = Date.now();

  const details = {
    name: field("name") || "Untitled piece",
    category: field("category") || categories[0],
    brand: field("brand") || UNKNOWN,
    color: field("color") || UNKNOWN,
    status: (field("status") || "Needs review") as Status
  };
  const image = file ? await readAsDataUrl(file) : existing?.image;
  const item: ClosetItem = existing
    ? { ...existing, ...details, image, updatedAt: now }
    : { id: newId(), ...details, image, favorite: false, createdAt: now, updatedAt: now };

  items = [item, ...items.filter((entry) => entry.id !== item.id)];
  recordActivity();
  itemDialog.close();
  render();
  bumpStats();

  const xpGained = totalXp() - xpBefore;
  if (levelFor(totalXp()) > levelFor(xpBefore)) {
    showToast({ title: `Level ${levelFor(totalXp())}!`, message: "Your closet is leveling up.", xp: xpGained });
  } else if (questBefore < QUEST_TARGET && questProgress() >= QUEST_TARGET) {
    showToast({ title: "Daily quest complete!", message: `${QUEST_TARGET} pieces with photos today. Nice work.`, xp: xpGained });
  } else {
    showToast({ title: existing ? "Saved" : "Nice!", message: existing ? `${item.name} is up to date.` : `${item.name} is in your closet.`, xp: xpGained > 0 ? xpGained : undefined });
  }
  await persist(saveItem(item));
}

function deleteEditingItem() {
  const item = items.find((entry) => entry.id === editingId);
  if (!item) return;
  items = items.filter((entry) => entry.id !== item.id);
  itemDialog.close();
  render();
  void persist(removeItem(item.id));
  showToast({
    kind: "info",
    title: "Deleted",
    message: `${item.name} was removed.`,
    action: {
      label: "Undo",
      run: () => {
        items = [item, ...items];
        render();
        void persist(saveItem(item));
      }
    }
  });
}

/* ---------- Collections ---------- */

function openCollectionForm() {
  collectionForm.hidden = false;
  collectionInput.focus();
}

function closeCollectionForm() {
  collectionForm.hidden = true;
  collectionInput.value = "";
}

function createCollection(rawName: string) {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name) return;
  const existing = categories.find((entry) => entry.toLowerCase() === name.toLowerCase());
  closeCollectionForm();
  if (existing) {
    showToast({ kind: "info", title: "Already there", message: `You have a ${existing} collection.` });
    return;
  }
  categories = [...categories, name];
  render();
  void persist(saveMeta("categories", categories));
  showToast({ title: "Collection created", message: `${name} is ready for pieces.` });
}

/* ---------- Events ---------- */

window.addEventListener("hashchange", () => applyHash(location.hash));
$(".tabbar").addEventListener("click", (event) => {
  const link = (event.target as Element).closest<HTMLAnchorElement>("a[href^='#']");
  if (!link) return;
  // Re-tapping the current tab still resets its filters, which hashchange alone would miss.
  applyHash(link.hash);
  window.scrollTo({ top: 0 });
});

$("#addFab").addEventListener("click", () => openItemDialog());

grid.addEventListener("click", (event) => {
  const target = event.target as Element;
  const card = target.closest<HTMLElement>(".item-card");
  if (!card) return;
  const item = items.find((entry) => entry.id === card.dataset.id);
  if (!item) {
    openItemDialog();
    return;
  }
  if (target.closest("[data-favorite]")) {
    item.favorite = !item.favorite;
    render();
    void persist(saveItem(item));
    return;
  }
  openItemDialog(item);
});

$("#categoryFilters").addEventListener("click", (event) => {
  const chip = (event.target as Element).closest<HTMLButtonElement>("[data-category]");
  if (!chip) return;
  activeCategory = chip.dataset.category ?? "all";
  if (tab === "closet") history.replaceState(null, "", activeCategory === "all" ? "#closet" : collectionHash(activeCategory));
  render();
});

$("#filterButton").addEventListener("click", () => {
  const row = $("#filterRow");
  row.hidden = !row.hidden;
  $("#filterButton").setAttribute("aria-expanded", String(!row.hidden));
});
document.querySelectorAll<HTMLButtonElement>("[data-status]").forEach((button) => button.addEventListener("click", () => {
  activeStatus = button.dataset.status ?? "all";
  document.querySelectorAll("[data-status]").forEach((chip) => chip.classList.toggle("is-on", chip === button));
  render();
}));

searchInput.addEventListener("input", renderCatalog);

document.querySelectorAll<HTMLButtonElement>("[data-layout]").forEach((button) => button.addEventListener("click", () => {
  layout = button.dataset.layout === "list" ? "list" : "grid";
  document.querySelectorAll<HTMLButtonElement>("[data-layout]").forEach((entry) => {
    entry.classList.toggle("is-on", entry === button);
    entry.setAttribute("aria-pressed", String(entry === button));
  });
  renderCatalog();
}));

$("#emptyAction").addEventListener("click", (event) => {
  const action = (event.currentTarget as HTMLElement).dataset.action as EmptyAction;
  if (action === "add") openItemDialog();
  else if (action === "closet") location.hash = "#closet";
  else {
    searchInput.value = "";
    activeStatus = "all";
    document.querySelectorAll("[data-status]").forEach((chip) => chip.classList.toggle("is-on", (chip as HTMLElement).dataset.status === "all"));
    render();
  }
});

itemDialog.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => itemDialog.close()));
itemDialog.addEventListener("click", (event) => {
  if (event.target === itemDialog) itemDialog.close();
});
itemDialog.addEventListener("close", () => {
  editingId = null;
  clearPreviewUrl();
  itemForm.reset();
});
photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  if (!file) return;
  clearPreviewUrl();
  previewUrl = URL.createObjectURL(file);
  setPhotoPreview(previewUrl);
});
itemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const saveButton = $<HTMLButtonElement>("#saveItemButton");
  saveButton.disabled = true;
  try {
    await saveFromForm();
  } finally {
    saveButton.disabled = false;
  }
});
$("#deleteItemButton").addEventListener("click", deleteEditingItem);

$("#collectionGrid").addEventListener("click", (event) => {
  if ((event.target as Element).closest("[data-new-collection]")) openCollectionForm();
});
collectionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  createCollection(collectionInput.value);
});
$("#collectionCancel").addEventListener("click", closeCollectionForm);
collectionInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeCollectionForm();
});

/* ---------- Start ---------- */

async function init() {
  document.querySelectorAll<HTMLElement>("[data-icon]").forEach((element) => {
    element.innerHTML = icons[element.dataset.icon as IconName] ?? "";
  });
  try {
    const [storedItems, storedCategories, storedDays] = await Promise.all([loadItems(), loadMeta<string[]>("categories"), loadMeta<string[]>("activityDays")]);
    items = storedItems;
    categories = storedCategories ?? categories;
    activityDays = storedDays ?? [];
  } catch (error) {
    console.error(error);
    showToast({ kind: "error", title: "Storage is off", message: "This browser can’t save your closet, so changes will be lost on refresh." });
  }
  // Keep every item's collection listed, even if it was added before the collection list was saved.
  categories = [...categories, ...new Set(items.map((item) => item.category).filter((name) => !categories.includes(name)))];
  applyHash(location.hash);
}

void init();
