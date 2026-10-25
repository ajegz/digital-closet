import "./styles.css";
import { icons, type IconName } from "./icons";
import { processPhoto } from "./photos";
import { initAccount } from "./account";
import { loadItems, loadMeta, loadRecords, removeItem, removeRecord, saveItem, saveMeta, saveRecord } from "./storage";
import { isSignedIn, requestSync, startSync } from "./sync";
import { OCCASIONS, UNKNOWN, WEATHER, type ClosetItem, type Collection, type Garment, type Occasion, type Outfit, type Status, type WearLog, type Weather } from "./types";

type Tab = "closet" | "favorites" | "recent" | "outfits" | "worn" | "collections";
type EmptyAction = "add" | "reset" | "closet";

const DEFAULT_CATEGORIES = ["Tops", "Bottoms", "Outerwear", "Dresses", "Accessories"];
const UNTITLED = "Untitled piece";
const RECENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// Until the closet holds this many pieces, "add new pieces" stays on the task ladder.
const STARTER_CLOSET = 20;
const MAX_TASKS = 3;
const TOAST_MS = 5000;
const COLLECTION_COLORS = ["var(--leaf)", "var(--sky)", "var(--grape)", "var(--flame)", "var(--berry)", "var(--sun-ledge)"];
const TAB_TITLES: Record<Tab, string> = { closet: "Closet", favorites: "Favorites", recent: "Recent", outfits: "Outfits", worn: "Worn", collections: "Collections" };
// A piece added this long ago and not worn for UNWORN_DAYS counts as "not worn lately".
const UNWORN_DAYS = 90;
const NEW_PIECE_GRACE_DAYS = 14;
// Fields that live inside the sheet's collapsed "More details" section.
const MORE_FIELDS = ["material", "price", "purchasedOn", "store", "weather", "occasions", "care"];

// What "fully described" means on the detail screen's progress bar.
const DETAIL_FIELDS: ((item: ClosetItem) => boolean)[] = [
  (item) => Boolean(item.image || item.thumb),
  (item) => known(item.brand),
  (item) => known(item.color),
  (item) => Boolean(item.size),
  (item) => Boolean(item.material),
  (item) => Boolean(item.weather?.length),
  (item) => Boolean(item.occasions?.length),
  (item) => item.price !== undefined,
  (item) => Boolean(item.purchasedOn),
  (item) => Boolean(item.store),
  (item) => Boolean(item.care)
];
// Everything but the photo, which has its own task.
const DESCRIBE_FIELDS = DETAIL_FIELDS.slice(1);

// Shown only while the closet is empty so the first screen isn't blank. Never saved.
const sampleItems: ClosetItem[] = [
  { id: "sample-tee", name: "Essential cotton tee", category: "Tops", brand: "Sample piece", color: "Ink black", status: "Needs review", garment: "tee", favorite: false, createdAt: 0, updatedAt: 0, sample: true },
  { id: "sample-shirt", name: "Relaxed overshirt", category: "Tops", brand: "Sample piece", color: "Leaf green", status: "Needs review", garment: "shirt", favorite: false, createdAt: 0, updatedAt: 0, sample: true },
  { id: "sample-pants", name: "Wide-leg trousers", category: "Bottoms", brand: "Sample piece", color: "Denim blue", status: "Needs review", garment: "pants", favorite: false, createdAt: 0, updatedAt: 0, sample: true },
  { id: "sample-coat", name: "Everyday chore coat", category: "Outerwear", brand: "Sample piece", color: "Rust orange", status: "Needs review", garment: "coat", favorite: false, createdAt: 0, updatedAt: 0, sample: true }
];

let items: ClosetItem[] = [];
let collections: Collection[] = [];
let outfits: Outfit[] = [];
let wearLogs: WearLog[] = [];
// Collection names in display order, plus any category a piece uses that has no collection record.
let categories = [...DEFAULT_CATEGORIES];
// Dated "" so todayLog() replaces it on first use; calling dayKey() here would run before its helpers exist.
let taskLog: TaskLog = emptyTaskLog("");
let tab: Tab = "closet";
let activeCategory = "all";
let activeStatus = "all";
let layout: "grid" | "list" = "grid";
let viewingItemId: string | null = null;
// Set when a card opens the detail screen, so Back returns to the same list and scroll position.
let detailReturn: { hash: string; scroll: number } | null = null;
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
const moreDetails = $<HTMLDetailsElement>("#moreDetails");
const saveButton = $<HTMLButtonElement>("#saveItemButton");
const formError = $<HTMLParagraphElement>("#formError");
const collectionForm = $<HTMLFormElement>("#collectionForm");
const collectionInput = $<HTMLInputElement>("#collectionInput");
const addMenu = $<HTMLDialogElement>("#addMenu");
const pickerDialog = $<HTMLDialogElement>("#pickerDialog");
const outfitNameInput = $<HTMLInputElement>("#outfitNameInput");
const wornOnInput = $<HTMLInputElement>("#wornOnInput");
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
const statusPill = (item: ClosetItem) => item.status === "Confirmed" ? `<span class="status-pill is-ok">Confirmed</span>` : `<span class="status-pill">Needs review</span>`;

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // randomUUID only exists on secure origins (e.g. not a phone on http://192.168…); the cloud needs a real v4 UUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

function formatPurchaseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function garmentFor(category: string): Garment {
  if (category === "Bottoms") return "pants";
  if (category === "Outerwear") return "coat";
  return "tee";
}

async function persist(task: Promise<unknown>) {
  try {
    await task;
  } catch (error) {
    console.error(error);
    showToast({ kind: "error", title: "Couldn’t save", message: "This browser blocked storage. Recent changes may be lost on refresh." });
  }
}

// For changes to pieces and collections: save locally, then let the cloud catch up.
async function persistAndSync(task: Promise<unknown>) {
  await persist(task);
  requestSync();
}

/* ---------- Today's tasks: a ladder built from what the closet is missing, easiest first ---------- */

type TaskKind = "log" | "photo" | "confirm" | "add" | "describe";

interface TaskLog {
  day: string;
  photo: number;
  confirm: number;
  add: number;
  describe: number;
  /** Tasks finished today stay ticked even if new pieces grow the backlog again. */
  completed: TaskKind[];
}

interface Task {
  kind: TaskKind;
  label: string;
  target: number;
  done: number;
}

function emptyTaskLog(day = dayKey()): TaskLog {
  return { day, photo: 0, confirm: 0, add: 0, describe: 0, completed: [] };
}

const hasPhoto = (item: ClosetItem) => Boolean(item.image || item.thumb);
const describedCount = (item: ClosetItem) => DESCRIBE_FIELDS.filter((isFilled) => isFilled(item)).length;

function todayLog() {
  if (taskLog.day !== dayKey()) taskLog = emptyTaskLog();
  taskLog.completed ??= [];
  return taskLog;
}

// Counts only real progress: a new piece, a first photo, a confirmation, or a field that was empty.
function logProgress(before: ClosetItem | undefined, after: ClosetItem, added = 1) {
  const log = todayLog();
  if (!before) log.add += added;
  else {
    if (!hasPhoto(before) && hasPhoto(after)) log.photo += 1;
    if (before.status !== "Confirmed" && after.status === "Confirmed") log.confirm += 1;
    if (describedCount(after) > describedCount(before)) log.describe += 1;
  }
  void persist(saveMeta("taskLog", log));
}

function todaysTasks(): Task[] {
  const log = todayLog();
  // Adding today's progress back keeps a task's target steady while the backlog shrinks.
  const missingPhoto = items.filter((item) => !hasPhoto(item)).length + log.photo;
  const needsReview = items.filter((item) => item.status === "Needs review").length + log.confirm;
  const undescribed = items.filter((item) => describedCount(item) < DESCRIBE_FIELDS.length).length + log.describe;
  const starter = items.length - log.add < STARTER_CLOSET;
  const ladder: Omit<Task, "label">[] = [
    { kind: "log", target: items.length ? 1 : 0, done: todayLogs().length ? 1 : 0 },
    { kind: "photo", target: Math.min(1, missingPhoto), done: log.photo },
    { kind: "confirm", target: Math.min(2, needsReview), done: log.confirm },
    { kind: "add", target: starter ? 3 : 0, done: log.add },
    { kind: "describe", target: Math.min(3, undescribed), done: log.describe }
  ];
  const labels: Record<TaskKind, (count: number) => string> = {
    log: () => "Log what you wore today",
    photo: (count) => `Add a photo to ${plural(count, "piece")}`,
    confirm: (count) => `Confirm ${plural(count, "piece")}`,
    add: (count) => `Add ${plural(count, "new piece")}`,
    describe: (count) => `Fill in details on ${plural(count, "piece")}`
  };
  const tasks = ladder
    .map((task) => (log.completed.includes(task.kind) ? { ...task, target: task.done } : task))
    .filter((task) => task.target > 0)
    .slice(0, MAX_TASKS)
    .map((task) => ({ ...task, done: Math.min(task.done, task.target), label: labels[task.kind](task.target) }));
  const newlyDone = tasks.filter((task) => task.done >= task.target && !log.completed.includes(task.kind));
  if (newlyDone.length) {
    log.completed = [...log.completed, ...newlyDone.map((task) => task.kind)];
    void persist(saveMeta("taskLog", log));
  }
  return tasks;
}

function allTasksDone() {
  const tasks = todaysTasks();
  return tasks.length > 0 && tasks.every((task) => task.done >= task.target);
}

function startTask(kind: TaskKind) {
  const newestFirst = [...items].sort((a, b) => b.createdAt - a.createdAt);
  if (kind === "log") {
    openPicker({ kind: "log" });
  } else if (kind === "add") {
    openItemDialog();
  } else if (kind === "photo") {
    const item = newestFirst.find((entry) => !hasPhoto(entry));
    if (item) openItemDialog(item, "photo");
  } else if (kind === "describe") {
    const item = newestFirst
      .filter((entry) => describedCount(entry) < DESCRIBE_FIELDS.length)
      .sort((a, b) => describedCount(a) - describedCount(b))[0];
    if (item) openDetail(item.id);
  } else {
    activeStatus = "Needs review";
    document.querySelectorAll<HTMLElement>("[data-status]").forEach((chip) => chip.classList.toggle("is-on", chip.dataset.status === activeStatus));
    $("#filterRow").hidden = false;
    $("#filterButton").setAttribute("aria-expanded", "true");
    render();
    $(".catalog-head").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/* ---------- Routing ---------- */

function applyHash(hash: string) {
  // Back/forward while a sheet is open should leave the sheet, like a native app.
  for (const dialog of [itemDialog, pickerDialog, addMenu]) if (dialog.open) dialog.close();

  if (hash.startsWith("#item-")) {
    const id = decodeURIComponent(hash.slice("#item-".length));
    if (items.some((item) => item.id === id)) {
      viewingItemId = id;
      render();
      window.scrollTo({ top: 0 });
      return;
    }
    history.replaceState(null, "", "#closet");
    hash = "#closet";
  }

  const returning = viewingItemId !== null && detailReturn?.hash === hash ? detailReturn : null;
  viewingItemId = null;
  detailReturn = null;

  if (hash.startsWith("#collection-")) {
    const name = decodeURIComponent(hash.slice("#collection-".length));
    tab = "closet";
    activeCategory = categories.includes(name) ? name : "all";
  } else {
    const name = hash.slice(1);
    tab = (["favorites", "recent", "outfits", "worn", "collections"] as const).find((entry) => entry === name) ?? "closet";
    activeCategory = "all";
  }
  render();
  if (returning) window.scrollTo({ top: returning.scroll });
}

function openDetail(id: string) {
  detailReturn = { hash: location.hash, scroll: window.scrollY };
  location.hash = `#item-${encodeURIComponent(id)}`;
}

function closeDetail() {
  if (detailReturn) history.back();
  else location.hash = "#closet";
}

/* ---------- Rendering ---------- */

function visibleItems() {
  const query = searchInput.value.trim().toLowerCase();
  const recentCutoff = Date.now() - RECENT_DAYS * DAY_MS;
  return (items.length ? items : sampleItems)
    .filter((item) => {
      if (tab === "favorites" && !item.favorite) return false;
      if (tab === "recent" && item.createdAt < recentCutoff) return false;
      const matchesText = [item.name, item.category, item.brand, item.color, item.material, item.store].join(" ").toLowerCase().includes(query);
      const matchesCategory = activeCategory === "all" || item.category === activeCategory;
      const matchesStatus = activeStatus === "all" || item.status === activeStatus;
      return matchesText && matchesCategory && matchesStatus;
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function cardHtml(item: ClosetItem) {
  const photo = item.thumb ?? item.image;
  const visual = photo
    ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy">`
    : `<div class="sample-garment ${item.garment ?? garmentFor(item.category)}" aria-hidden="true"></div>`;
  const heart = item.sample
    ? `<span class="tag">Sample</span>`
    : `<button class="heart-button${item.favorite ? " is-on" : ""}" data-favorite type="button" aria-pressed="${item.favorite}" aria-label="Favorite ${escapeHtml(item.name)}">${item.favorite ? icons.heartFilled : icons.heart}</button>`;
  const meta = [item.brand, item.color].filter(known).join(" · ") || item.category;
  const label = item.sample ? "Sample piece. Add your own" : `Open ${item.name}`;
  return `
    <article class="item-card${item.sample ? " is-sample" : ""}" data-id="${escapeHtml(item.id)}">
      <div class="item-visual">${visual}</div>
      ${heart}
      <div class="item-body"><h3><button class="item-link" type="button" aria-label="${escapeHtml(label)}">${escapeHtml(item.name)}</button></h3><p class="item-meta">${escapeHtml(meta)}</p>${statusPill(item)}</div>
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
  const viewing = viewingItemId ? items.find((item) => item.id === viewingItemId) : undefined;
  const screen = viewing ? "item" : tab === "outfits" || tab === "worn" || tab === "collections" ? tab : "closet";
  $("#itemScreen").hidden = screen !== "item";
  $("#closetScreen").hidden = screen !== "closet";
  $("#outfitsScreen").hidden = screen !== "outfits";
  $("#wornScreen").hidden = screen !== "worn";
  $("#collectionsScreen").hidden = screen !== "collections";
  $("#dashboard").hidden = tab !== "closet" || activeCategory !== "all";
  $("#screenTitle").textContent = viewing ? "Piece" : TAB_TITLES[tab];
  // Favorites and New are views inside the Closet tab.
  const navTab = tab === "favorites" || tab === "recent" ? "closet" : tab;
  document.querySelectorAll<HTMLAnchorElement>(".tab").forEach((link) => {
    if (link.dataset.tab === navTab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  renderStats();
  if (viewing) renderDetail(viewing);
  else if (screen === "outfits") renderOutfits();
  else if (screen === "worn") renderWorn();
  else if (screen === "collections") renderCollections();
  else renderCatalog();
}

function renderCatalog() {
  const visible = visibleItems();
  const title = tab === "favorites" ? "Favorites" : tab === "recent" ? "Recently added" : activeCategory === "all" ? "All items" : activeCategory;
  $("#viewTitle").textContent = title;
  $("#visibleCount").textContent = String(visible.length);

  const allOn = tab === "closet" && activeCategory === "all";
  const viewChip = (view: "favorites" | "recent", label: string, icon = "") =>
    `<button class="chip is-view${tab === view ? " is-on" : ""}" data-view="${view}" type="button" aria-pressed="${tab === view}">${icon}${label}</button>`;
  $("#categoryFilters").innerHTML =
    `<button class="chip${allOn ? " is-on" : ""}" data-category="all" type="button" aria-pressed="${allOn}">All</button>` +
    viewChip("favorites", "Favorites", icons.heart) +
    viewChip("recent", "New") +
    `<span class="chip-divider" aria-hidden="true"></span>` +
    categories
      .map((name) => `<button class="chip${name === activeCategory ? " is-on" : ""}" data-category="${escapeHtml(name)}" type="button" aria-pressed="${name === activeCategory}">${escapeHtml(name)}</button>`)
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

function renderDetail(item: ClosetItem) {
  $("#detailCollection").textContent = item.category;
  $("#detailName").textContent = item.name;
  $("#detailTags").innerHTML = statusPill(item);

  const favorite = $("#detailFavorite");
  favorite.innerHTML = item.favorite ? icons.heartFilled : icons.heart;
  favorite.classList.toggle("is-on", item.favorite);
  favorite.setAttribute("aria-pressed", String(item.favorite));
  favorite.setAttribute("aria-label", `Favorite ${item.name}`);

  const photo = item.image ?? item.thumb;
  $("#detailPhoto").innerHTML = photo
    ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(item.name)}">`
    : `<div class="sample-garment ${item.garment ?? garmentFor(item.category)}" aria-hidden="true"></div><button class="btn btn-secondary" type="button" data-edit-field="photo">${icons.camera}Add photo</button>`;

  const filled = DETAIL_FIELDS.filter((isFilled) => isFilled(item)).length;
  const complete = filled === DETAIL_FIELDS.length;
  $("#detailProgressTitle").textContent = complete ? "Fully described" : "Details";
  $("#detailProgressCount").textContent = `${filled}/${DETAIL_FIELDS.length}`;
  $("#detailProgressBar").style.width = `${(filled / DETAIL_FIELDS.length) * 100}%`;
  document.querySelector(".detail-progress")?.classList.toggle("is-done", complete);

  const rows: [label: string, field: string, value: string | undefined][] = [
    ["Brand", "brand", known(item.brand) ? item.brand : undefined],
    ["Color", "color", known(item.color) ? item.color : undefined],
    ["Size", "size", item.size],
    ["Material", "material", item.material],
    ["Weather", "weather", item.weather?.join(", ") || undefined],
    ["Occasion", "occasions", item.occasions?.join(", ") || undefined],
    ["Price", "price", item.price !== undefined ? item.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : undefined],
    ["Purchased", "purchasedOn", item.purchasedOn ? formatPurchaseDate(item.purchasedOn) : undefined],
    ["Where from", "store", item.store]
  ];
  $("#detailList").innerHTML = rows
    .map(([label, field, value]) => `<div class="detail-row"><dt>${label}</dt><dd>${value ? escapeHtml(value) : `<button class="detail-add" type="button" data-edit-field="${field}" aria-label="Add ${label.toLowerCase()}">Add</button>`}</dd></div>`)
    .join("") + `<div class="detail-row"><dt>Added</dt><dd>${relativeDay(item.createdAt)}</dd></div>`;

  renderWearCard(item);

  $("#detailCareText").innerHTML = item.care
    ? escapeHtml(item.care)
    : `<button class="detail-add" type="button" data-edit-field="care">Add care notes</button>`;
}

function renderStats() {
  const count = items.length;

  $("#todayLabel").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  $("#greeting").textContent = count ? `${plural(count, "piece")} and counting` : "Let’s fill your closet";
  renderHeroToday();
  renderTasks();

  const stats = wearIndex();
  const mostWorn = items.reduce<{ item?: ClosetItem; count: number }>((best, item) => {
    const worn = stats.get(item.id)?.count ?? 0;
    return worn > best.count ? { item, count: worn } : best;
  }, { count: 0 });
  $("#itemStat").textContent = String(count);
  $("#missingStat").textContent = String(items.filter((item) => item.status === "Needs review").length);
  $("#mostWornStat").textContent = mostWorn.item?.name ?? "—";
  $("#mostWornNote").textContent = mostWorn.item ? plural(mostWorn.count, "wear") : "Log outfits to see this";
  const unworn = unwornPieces(stats);
  $("#unwornStat").textContent = String(unworn.length);

  // Only meaningful once there's a wear history to compare against.
  $("#rediscover").hidden = !wearLogs.length || !unworn.length;
  $("#rediscoverRow").innerHTML = unworn.slice(0, 8).map((item) => {
    const last = stats.get(item.id)?.last;
    return `<button class="mini-card" type="button" data-open-item="${escapeHtml(item.id)}">${thumbHtml(item, "mini-thumb")}<span class="mini-name">${escapeHtml(item.name)}</span><span class="mini-meta">${last ? `Last worn ${formatDay(last)}` : "Not worn yet"}</span></button>`;
  }).join("");
}

function renderTasks() {
  const tasks = todaysTasks();
  const done = tasks.filter((task) => task.done >= task.target).length;
  const allDone = tasks.length > 0 && done === tasks.length;
  $("#tasksCard").classList.toggle("is-done", allDone);
  $("#tasksCount").hidden = !tasks.length;
  $("#tasksCount").textContent = `${done}/${tasks.length}`;
  $("#tasksTitle").textContent = !tasks.length ? "All caught up" : allDone ? "All done for today" : done ? `${done} of ${tasks.length} done` : "Quick wins for today";
  $("#tasksEmpty").hidden = tasks.length > 0;
  $("#taskList").innerHTML = tasks
    .map((task) => {
      const finished = task.done >= task.target;
      const body = `<span class="task-check">${finished ? icons.check : ""}</span><span class="task-text">${task.label}</span><span class="task-progress">${task.done}/${task.target}</span>`;
      return `<li>${finished ? `<div class="task is-done">${body}</div>` : `<button class="task" type="button" data-task="${task.kind}">${body}</button>`}</li>`;
    })
    .join("");
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

function renderChipOptions(container: HTMLElement, name: string, options: readonly string[]) {
  container.insertAdjacentHTML("beforeend", options.map((option) => `<label class="chip"><input type="checkbox" name="${name}" value="${option}" /> ${option}</label>`).join(""));
}

/* ---------- Feedback banner ---------- */

interface ToastOptions {
  kind?: "success" | "error" | "info";
  title: string;
  message: string;
  action?: { label: string; run: () => void };
}

function showToast({ kind = "success", title, message, action }: ToastOptions) {
  window.clearTimeout(toastTimer);
  toast.hidden = true;
  toast.className = `toast${kind === "success" ? "" : ` is-${kind}`}`;
  $("#toastIcon").innerHTML = kind === "success" ? icons.hangie : "";
  $("#toastTitle").textContent = title;
  $("#toastMessage").textContent = message;
  const button = $<HTMLButtonElement>("#toastAction");
  button.hidden = !action;
  button.textContent = action?.label ?? "";
  button.onclick = action ? () => { action.run(); toast.hidden = true; } : null;
  // Re-showing restarts the slide-up animation.
  void toast.offsetWidth;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, TOAST_MS);
}


/* ---------- Add / edit sheet ---------- */

function formField<T extends HTMLInputElement | HTMLTextAreaElement = HTMLInputElement>(name: string) {
  return itemForm.elements.namedItem(name) as T;
}

function setChecked(name: string, values: readonly string[] = []) {
  itemForm.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((input) => { input.checked = values.includes(input.value); });
}

function setPhotoPreview(src?: string, count = 1) {
  const preview = $<HTMLImageElement>("#photoPreview");
  preview.hidden = !src;
  if (src) preview.src = src;
  else preview.removeAttribute("src");
  $("#uploadZone").classList.toggle("has-photo", Boolean(src));
  $("#uploadTitle").textContent = count > 1 ? `${count} photos · one piece each` : src ? "Change photo" : "Add a photo";
  const badge = $("#uploadCount");
  badge.hidden = count < 2;
  badge.textContent = `+${count - 1}`;
}

function clearPreviewUrl() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

function moreDetailsFilled(item?: ClosetItem) {
  if (!item) return 0;
  return [item.material, item.price, item.purchasedOn, item.store, item.weather?.length, item.occasions?.length, item.care].filter((value) => value !== undefined && value !== "" && value !== 0).length;
}

function openItemDialog(item?: ClosetItem, focusField?: string) {
  editingId = item?.id ?? null;
  itemForm.reset();
  clearPreviewUrl();
  formError.hidden = true;
  renderCategoryOptions(item?.category ?? (activeCategory !== "all" ? activeCategory : categories[0]));
  formField("name").value = item?.name ?? "";
  formField("brand").value = item && known(item.brand) ? item.brand : "";
  formField("color").value = item && known(item.color) ? item.color : "";
  formField("size").value = item?.size ?? "";
  formField("material").value = item?.material ?? "";
  formField("price").value = item?.price !== undefined ? String(item.price) : "";
  formField("purchasedOn").value = item?.purchasedOn ?? "";
  formField("store").value = item?.store ?? "";
  formField<HTMLTextAreaElement>("care").value = item?.care ?? "";
  setChecked("weather", item?.weather);
  setChecked("occasions", item?.occasions);
  (itemForm.elements.namedItem("status") as RadioNodeList).value = item?.status ?? "Needs review";

  // Several photos at once only make sense when adding: each one becomes its own piece.
  photoInput.multiple = !item;
  setPhotoPreview(item?.image ?? item?.thumb);
  const filledMore = moreDetailsFilled(item);
  $("#moreDetailsHint").textContent = filledMore ? `${filledMore} filled` : "Material, price, care…";
  moreDetails.open = Boolean(focusField && MORE_FIELDS.includes(focusField));

  $("#dialogEyebrow").textContent = item ? "Edit piece" : "New piece";
  $("#dialogTitle").textContent = item ? "Refine the details" : "Bring in a piece";
  saveButton.textContent = item ? "Save changes" : "Add to closet";
  $("#deleteItemButton").hidden = !item;
  itemDialog.showModal();

  if (focusField === "photo") photoInput.focus();
  else if (focusField) itemForm.querySelector<HTMLElement>(`[name="${focusField}"]`)?.focus();
}

function readDetails(formData: FormData) {
  const field = (name: string) => String(formData.get(name) ?? "").trim();
  const price = field("price") === "" ? undefined : Number(field("price"));
  const weather = formData.getAll("weather").filter((value): value is Weather => WEATHER.includes(value as Weather));
  const occasions = formData.getAll("occasions").filter((value): value is Occasion => OCCASIONS.includes(value as Occasion));
  // Empty optional fields become undefined so clearing a field in the editor really clears it.
  return {
    name: field("name") || UNTITLED,
    category: field("category") || categories[0],
    brand: field("brand") || UNKNOWN,
    color: field("color") || UNKNOWN,
    status: (field("status") || "Needs review") as Status,
    size: field("size") || undefined,
    material: field("material") || undefined,
    price: price !== undefined && Number.isFinite(price) && price >= 0 ? price : undefined,
    purchasedOn: field("purchasedOn") || undefined,
    store: field("store") || undefined,
    care: field("care") || undefined,
    weather: weather.length ? weather : undefined,
    occasions: occasions.length ? occasions : undefined
  };
}

function celebrate(tasksDoneBefore: boolean, fallback: { title: string; message: string }) {
  if (!tasksDoneBefore && allTasksDone()) showToast({ title: "Today’s tasks done!", message: "Your closet is in better shape than this morning." });
  else showToast(fallback);
}

async function saveFromForm() {
  const details = readDetails(new FormData(itemForm));
  const files = Array.from(photoInput.files ?? []);
  const existing = items.find((entry) => entry.id === editingId);
  const tasksDoneBefore = allTasksDone();

  if (!existing && files.length > 1) {
    await saveMany(files, details, tasksDoneBefore);
    return;
  }

  if (files[0]) saveButton.textContent = "Preparing photo…";
  const photo = files[0] ? await processPhoto(files[0]) : { image: existing?.image, thumb: existing?.thumb };
  const now = Date.now();
  const sync = { dirty: true, photoDirty: files[0] ? true : existing?.photoDirty ?? Boolean(photo.image) };
  const item: ClosetItem = existing
    ? { ...existing, ...details, ...photo, ...sync, updatedAt: now }
    : { id: newId(), ...details, ...photo, ...sync, favorite: false, createdAt: now, updatedAt: now };

  items = [item, ...items.filter((entry) => entry.id !== item.id)];
  logProgress(existing, item);
  itemDialog.close();
  render();
  celebrate(tasksDoneBefore, existing
    ? { title: "Saved", message: `${item.name} is up to date.` }
    : { title: "Nice!", message: `${item.name} is in your closet.` });
  await persistAndSync(saveItem(item));
}

async function saveMany(files: File[], details: ReturnType<typeof readDetails>, tasksDoneBefore: boolean) {
  const created: ClosetItem[] = [];
  for (const [index, file] of files.entries()) {
    saveButton.textContent = `Adding ${index + 1} of ${files.length}…`;
    const photo = await processPhoto(file);
    // The list is newest-first, so earlier picks get later timestamps to show in the order they were picked.
    const now = Date.now() - index;
    const name = details.name === UNTITLED ? UNTITLED : `${details.name} ${index + 1}`;
    created.push({ id: newId(), ...details, name, ...photo, dirty: true, photoDirty: true, favorite: false, createdAt: now, updatedAt: now });
  }
  items = [...created, ...items];
  logProgress(undefined, created[0], created.length);
  itemDialog.close();
  render();
  celebrate(tasksDoneBefore, { title: `${created.length} pieces added`, message: "Open each one to fill in the details." });
  await persistAndSync(Promise.all(created.map(saveItem)));
}

function deleteEditingItem() {
  const item = items.find((entry) => entry.id === editingId);
  if (!item) return;
  items = items.filter((entry) => entry.id !== item.id);
  itemDialog.close();
  if (viewingItemId === item.id) closeDetail();
  else render();
  // Signed in, the deletion has to reach other devices, so keep a marker until it's synced.
  const now = Date.now();
  void persistAndSync(isSignedIn() ? saveItem({ ...item, deletedAt: now, updatedAt: now, dirty: true }) : removeItem(item.id));
  showToast({
    kind: "info",
    title: "Deleted",
    message: `${item.name} was removed.`,
    action: {
      label: "Undo",
      run: () => {
        // The cloud may already have dropped the photo with the deletion, so send it again.
        const restored = { ...item, updatedAt: Date.now(), dirty: true, photoDirty: Boolean(item.image) };
        items = [restored, ...items];
        render();
        void persistAndSync(saveItem(restored));
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
  const position = Math.max(-1, ...collections.map((collection) => collection.position)) + 1;
  collections = [...collections, { id: newId(), name, position, updatedAt: Date.now(), dirty: true }];
  refreshCategories();
  render();
  void persistAndSync(saveMeta("collections", collections));
  showToast({ title: "Collection created", message: `${name} is ready for pieces.` });
}

/* ---------- Outfits and wear log ---------- */

interface WearStats {
  count: number;
  /** Most recent day worn, YYYY-MM-DD. */
  last?: string;
}

type PickerMode = { kind: "outfit"; outfit?: Outfit } | { kind: "log"; log?: WearLog; itemIds?: string[] };

let picker: PickerMode = { kind: "outfit" };
let pickerSelected = new Set<string>();
let pickerCategory = "all";

const dateFromKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const formatDay = (key: string) => relativeDay(dateFromKey(key).getTime());
const todayLogs = () => wearLogs.filter((log) => log.wornOn === dayKey());
const itemLookup = () => new Map(items.map((item) => [item.id, item]));
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

// Times worn counts days, so logging the same piece twice in one day still counts once.
function wearIndex() {
  const days = new Map<string, Set<string>>();
  for (const log of wearLogs) {
    for (const id of log.itemIds) {
      const set = days.get(id) ?? new Set<string>();
      set.add(log.wornOn);
      days.set(id, set);
    }
  }
  const stats = new Map<string, WearStats>();
  for (const [id, set] of days) stats.set(id, { count: set.size, last: [...set].sort().at(-1) });
  return stats;
}

function unwornPieces(stats: Map<string, WearStats>) {
  const cutoff = dayKey(Date.now() - UNWORN_DAYS * DAY_MS);
  const settled = Date.now() - NEW_PIECE_GRACE_DAYS * DAY_MS;
  return items
    .filter((item) => item.createdAt < settled && (stats.get(item.id)?.last ?? "") < cutoff)
    // Never worn first, then the longest since last worn.
    .sort((a, b) => (stats.get(a.id)?.last ?? "").localeCompare(stats.get(b.id)?.last ?? "") || a.createdAt - b.createdAt);
}

function thumbHtml(item: ClosetItem | undefined, className = "thumb") {
  if (!item) return "";
  const photo = item.thumb ?? item.image;
  const inner = photo
    ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy">`
    : `<span class="sample-garment ${item.garment ?? garmentFor(item.category)}" aria-hidden="true"></span>`;
  return `<span class="${className}">${inner}</span>`;
}

function thumbStrip(ids: string[], max = 4) {
  const lookup = itemLookup();
  const pieces = ids.map((id) => lookup.get(id)).filter((item): item is ClosetItem => Boolean(item));
  const more = pieces.length > max ? `<span class="thumb-more">+${pieces.length - max}</span>` : "";
  return `<span class="thumb-strip">${pieces.slice(0, max).map((item) => thumbHtml(item)).join("")}${more}</span>`;
}

function renderHeroToday() {
  const sub = $("#heroSub");
  if (!items.length) {
    sub.textContent = "Everything you own, easy to find.";
    return;
  }
  const lookup = itemLookup();
  const names = [...new Set(todayLogs().flatMap((log) => log.itemIds))].map((id) => lookup.get(id)?.name).filter(Boolean) as string[];
  sub.innerHTML = names.length
    ? `Today: ${escapeHtml(names.slice(0, 3).join(", "))}${names.length > 3 ? ` +${names.length - 3}` : ""}`
    : `Nothing logged today. <button class="text-button" type="button" data-open-picker="log">Log what you’re wearing</button>`;
}

function renderWearCard(item: ClosetItem) {
  const stats = wearIndex().get(item.id);
  const count = stats?.count ?? 0;
  $("#wearCount").textContent = String(count);
  $("#wearLast").textContent = stats?.last ? formatDay(stats.last) : "—";
  $("#wearCost").textContent = item.price !== undefined && count ? (item.price / count).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";
  const wornToday = todayLogs().some((log) => log.itemIds.includes(item.id));
  const button = $<HTMLButtonElement>("#woreTodayButton");
  button.disabled = wornToday;
  button.textContent = wornToday ? "Worn today" : "Wore it today";
  const inOutfits = outfits.filter((outfit) => outfit.itemIds.includes(item.id)).map((outfit) => outfit.name);
  const note = $("#detailOutfits");
  note.hidden = !inOutfits.length;
  note.textContent = inOutfits.length ? `In ${inOutfits.length === 1 ? "outfit" : "outfits"}: ${inOutfits.join(", ")}` : "";
}

function renderOutfits() {
  const lookup = itemLookup();
  const sorted = [...outfits].sort((a, b) => b.updatedAt - a.updatedAt);
  $("#outfitCount").textContent = String(sorted.length);
  $("#outfitsEmpty").hidden = sorted.length > 0;
  $("#outfitGrid").innerHTML = sorted.map((outfit) => {
    const pieces = outfit.itemIds.map((id) => lookup.get(id)).filter((item): item is ClosetItem => Boolean(item));
    const shown = pieces.slice(0, 4);
    const timesWorn = new Set(wearLogs.filter((log) => log.outfitId === outfit.id).map((log) => log.wornOn)).size;
    const cells = shown.length ? shown.map((item) => thumbHtml(item, "collage-cell")).join("") : `<span class="collage-cell">${icons.hanger}</span>`;
    return `<button class="outfit-card" type="button" data-outfit="${escapeHtml(outfit.id)}">
      <span class="collage is-${Math.max(1, shown.length)}">${cells}</span>
      <span class="outfit-name">${escapeHtml(outfit.name)}</span>
      <span class="outfit-meta">${plural(pieces.length, "piece")} · ${timesWorn ? `Worn ${plural(timesWorn, "time")}` : "Not worn yet"}</span>
    </button>`;
  }).join("");
}

function renderWorn() {
  const today = todayLogs();
  const todayIds = [...new Set(today.flatMap((log) => log.itemIds))];
  $("#todayCard").innerHTML = !items.length
    ? `<div class="today-head"><span class="today-mascot">${icons.hangie}</span><div><p class="eyebrow">Today</p><h2 class="hero-title">Add a few pieces first</h2></div></div>
       <button class="btn btn-primary" type="button" data-add-piece>Add a piece</button>`
    : today.length
      ? `<div class="today-head"><div><p class="eyebrow">Today</p><h2 class="hero-title">You’re wearing</h2></div></div>
         ${thumbStrip(todayIds, 6)}
         <div class="today-actions"><button class="btn btn-secondary" type="button" data-edit-log="${escapeHtml(today[0].id)}">Edit</button><button class="btn btn-secondary" type="button" data-open-picker="log">Add more</button></div>`
      : `<div class="today-head"><span class="today-mascot">${icons.hangie}</span><div><p class="eyebrow">Today</p><h2 class="hero-title">What are you wearing?</h2></div></div>
         <button class="btn btn-primary" type="button" data-open-picker="log">Log today’s outfit</button>`;

  const sorted = [...wearLogs].sort((a, b) => b.wornOn.localeCompare(a.wornOn) || b.createdAt - a.createdAt);
  $("#wornCount").textContent = String(sorted.length);
  $("#wornEmpty").hidden = sorted.length > 0;
  let month = "";
  $("#wornList").innerHTML = sorted.map((log) => {
    const date = dateFromKey(log.wornOn);
    const monthKey = log.wornOn.slice(0, 7);
    const header = monthKey === month ? "" : `<h3 class="month-label">${date.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h3>`;
    month = monthKey;
    const outfit = outfits.find((entry) => entry.id === log.outfitId);
    const label = outfit?.name ?? plural(log.itemIds.length, "piece");
    return `${header}<button class="worn-row" type="button" data-log="${escapeHtml(log.id)}">
      <span class="worn-date"><b>${date.getDate()}</b><small>${date.toLocaleDateString(undefined, { weekday: "short" })}</small></span>
      <span class="worn-body"><span class="worn-name">${escapeHtml(label)}</span>${thumbStrip(log.itemIds, 5)}</span>
    </button>`;
  }).join("");
}

function openPicker(mode: PickerMode) {
  if (addMenu.open) addMenu.close();
  picker = mode;
  pickerCategory = "all";
  const isOutfit = mode.kind === "outfit";
  const existing = isOutfit ? mode.outfit : mode.log;
  pickerSelected = new Set(isOutfit ? mode.outfit?.itemIds ?? [] : mode.log?.itemIds ?? mode.itemIds ?? []);
  $("#outfitNameField").hidden = !isOutfit;
  $("#wornOnField").hidden = isOutfit;
  outfitNameInput.value = isOutfit ? mode.outfit?.name ?? "" : "";
  wornOnInput.value = !isOutfit && mode.log ? mode.log.wornOn : dayKey();
  wornOnInput.max = dayKey();
  $("#pickerEyebrow").textContent = isOutfit ? (existing ? "Edit outfit" : "New outfit") : existing ? "Edit log" : "Log what you wore";
  $("#pickerTitle").textContent = isOutfit ? (mode.outfit ? mode.outfit.name : "Put an outfit together") : "What did you wear?";
  $("#pickerSave").textContent = existing ? "Save" : isOutfit ? "Create outfit" : "Log it";
  $("#pickerDelete").hidden = !existing;
  $("#pickerWearToday").hidden = !(isOutfit && existing);
  const shortcuts = $("#pickerOutfits");
  shortcuts.hidden = isOutfit || !outfits.length;
  shortcuts.innerHTML = isOutfit ? "" : outfits.map((outfit) => `<button class="chip" type="button" data-use-outfit="${escapeHtml(outfit.id)}">${icons.layers}${escapeHtml(outfit.name)}</button>`).join("");
  showError($("#pickerError"));
  renderPicker();
  pickerDialog.showModal();
}

function showError(element: HTMLElement, message?: string) {
  element.hidden = !message;
  element.textContent = message ?? "";
}

function renderPicker() {
  const used = categories.filter((name) => items.some((item) => item.category === name));
  $("#pickerFilters").innerHTML = ["all", ...used]
    .map((name) => `<button class="chip${name === pickerCategory ? " is-on" : ""}" type="button" data-picker-category="${escapeHtml(name)}">${name === "all" ? "All" : escapeHtml(name)}</button>`)
    .join("");
  const shown = items
    .filter((item) => pickerCategory === "all" || item.category === pickerCategory)
    .sort((a, b) => b.createdAt - a.createdAt);
  $("#pickerGrid").innerHTML = shown.length
    ? shown.map((item) => {
        const on = pickerSelected.has(item.id);
        return `<button class="pick" type="button" data-pick="${escapeHtml(item.id)}" aria-pressed="${on}">${thumbHtml(item, "mini-thumb")}<span class="pick-check">${icons.check}</span><span class="mini-name">${escapeHtml(item.name)}</span></button>`;
      }).join("")
    : `<p class="picker-empty">${items.length ? "Nothing in this collection yet." : "Add some pieces to your closet first."}</p>`;
  const count = [...pickerSelected].filter((id) => items.some((item) => item.id === id)).length;
  $("#pickerCount").textContent = count ? `${plural(count, "piece")} selected` : "Pick the pieces";
}

function selectedIds() {
  return [...pickerSelected].filter((id) => items.some((item) => item.id === id));
}

function savePicker() {
  const ids = selectedIds();
  if (!ids.length) {
    showError($("#pickerError"), "Pick at least one piece.");
    return;
  }
  const now = Date.now();
  if (picker.kind === "outfit") {
    const existing = picker.outfit;
    const name = outfitNameInput.value.trim() || existing?.name || `Outfit ${outfits.length + 1}`;
    const outfit: Outfit = existing
      ? { ...existing, name, itemIds: ids, updatedAt: now, dirty: true }
      : { id: newId(), name, itemIds: ids, createdAt: now, updatedAt: now, dirty: true };
    outfits = [outfit, ...outfits.filter((entry) => entry.id !== outfit.id)];
    pickerDialog.close();
    render();
    showToast({ title: existing ? "Outfit saved" : "Outfit created", message: `${name} · ${plural(ids.length, "piece")}` });
    void persistAndSync(saveRecord("outfits", outfit));
    return;
  }
  const wornOn = wornOnInput.value || dayKey();
  if (wornOn > dayKey()) {
    showError($("#pickerError"), "Pick today or an earlier day.");
    return;
  }
  const existing = picker.log;
  // Remember which outfit this was when the pieces match one exactly.
  const outfitId = outfits.find((outfit) => sameSet(outfit.itemIds, ids))?.id;
  const log: WearLog = existing
    ? { ...existing, wornOn, itemIds: ids, outfitId, updatedAt: now, dirty: true }
    : { id: newId(), wornOn, itemIds: ids, outfitId, createdAt: now, updatedAt: now, dirty: true };
  saveLog(log, wornOn === dayKey() ? `Today: ${plural(ids.length, "piece")}.` : `${formatDay(wornOn)}: ${plural(ids.length, "piece")}.`);
}

function saveLog(log: WearLog, message: string) {
  const tasksDoneBefore = allTasksDone();
  wearLogs = [log, ...wearLogs.filter((entry) => entry.id !== log.id)];
  if (pickerDialog.open) pickerDialog.close();
  render();
  celebrate(tasksDoneBefore, { title: "Logged", message });
  void persistAndSync(saveRecord("wearLogs", log));
}

function logOutfitToday(outfit: Outfit) {
  const now = Date.now();
  const itemIds = outfit.itemIds.filter((id) => items.some((item) => item.id === id));
  saveLog({ id: newId(), wornOn: dayKey(), itemIds, outfitId: outfit.id, createdAt: now, updatedAt: now, dirty: true }, `${outfit.name} is logged for today.`);
}

// "Wore it today" on a piece joins today's latest log rather than starting a new one.
function addPieceToToday(item: ClosetItem) {
  const now = Date.now();
  const latest = todayLogs().sort((a, b) => b.createdAt - a.createdAt)[0];
  if (latest?.itemIds.includes(item.id)) return;
  const itemIds = latest ? [...latest.itemIds, item.id] : [item.id];
  // An outfit plus an extra layer still counts as wearing that outfit.
  const outfitId = latest?.outfitId ?? outfits.find((outfit) => sameSet(outfit.itemIds, itemIds))?.id;
  const log: WearLog = latest
    ? { ...latest, itemIds, outfitId, updatedAt: now, dirty: true }
    : { id: newId(), wornOn: dayKey(), itemIds, outfitId, createdAt: now, updatedAt: now, dirty: true };
  saveLog(log, `${item.name} is logged for today.`);
}

function deletePickerRecord() {
  const now = Date.now();
  pickerDialog.close();
  if (picker.kind === "outfit" && picker.outfit) {
    const outfit = picker.outfit;
    outfits = outfits.filter((entry) => entry.id !== outfit.id);
    render();
    void persistAndSync(isSignedIn() ? saveRecord("outfits", { ...outfit, deletedAt: now, updatedAt: now, dirty: true }) : removeRecord("outfits", outfit.id));
    showToast({ kind: "info", title: "Outfit deleted", message: `${outfit.name} was removed. Your wear history keeps its pieces.`, action: { label: "Undo", run: () => {
      const restored = { ...outfit, updatedAt: Date.now(), dirty: true };
      outfits = [restored, ...outfits];
      render();
      void persistAndSync(saveRecord("outfits", restored));
    } } });
  } else if (picker.kind === "log" && picker.log) {
    const log = picker.log;
    wearLogs = wearLogs.filter((entry) => entry.id !== log.id);
    render();
    void persistAndSync(isSignedIn() ? saveRecord("wearLogs", { ...log, deletedAt: now, updatedAt: now, dirty: true }) : removeRecord("wearLogs", log.id));
    showToast({ kind: "info", title: "Log deleted", message: `${formatDay(log.wornOn)} was removed.`, action: { label: "Undo", run: () => {
      const restored = { ...log, updatedAt: Date.now(), dirty: true };
      wearLogs = [restored, ...wearLogs];
      render();
      void persistAndSync(saveRecord("wearLogs", restored));
    } } });
  }
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

$("#addFab").addEventListener("click", () => addMenu.showModal());
addMenu.addEventListener("click", (event) => {
  const target = event.target as Element;
  if (event.target === addMenu || target.closest("[data-close-menu]")) {
    addMenu.close();
    return;
  }
  const option = target.closest<HTMLElement>("[data-add]");
  if (!option) return;
  addMenu.close();
  if (option.dataset.add === "piece") openItemDialog();
  else openPicker({ kind: option.dataset.add === "log" ? "log" : "outfit" });
});

// Buttons rendered in several places: hero, empty states, today card, rediscover.
document.addEventListener("click", (event) => {
  const target = event.target as Element;
  const openPickerButton = target.closest<HTMLElement>("[data-open-picker]");
  if (openPickerButton) openPicker({ kind: openPickerButton.dataset.openPicker === "log" ? "log" : "outfit" });
  else if (target.closest("[data-add-piece]")) openItemDialog();
  else {
    const piece = target.closest<HTMLElement>("[data-open-item]");
    if (piece?.dataset.openItem) openDetail(piece.dataset.openItem);
  }
});

$("#newOutfitButton").addEventListener("click", () => openPicker({ kind: "outfit" }));
$("#outfitGrid").addEventListener("click", (event) => {
  const card = (event.target as Element).closest<HTMLElement>("[data-outfit]");
  const outfit = outfits.find((entry) => entry.id === card?.dataset.outfit);
  if (outfit) openPicker({ kind: "outfit", outfit });
});
$("#wornScreen").addEventListener("click", (event) => {
  const row = (event.target as Element).closest<HTMLElement>("[data-log], [data-edit-log]");
  const log = wearLogs.find((entry) => entry.id === (row?.dataset.log ?? row?.dataset.editLog));
  if (log) openPicker({ kind: "log", log });
});

pickerDialog.addEventListener("click", (event) => {
  const target = event.target as Element;
  if (event.target === pickerDialog || target.closest("[data-close-picker]")) {
    pickerDialog.close();
    return;
  }
  const pick = target.closest<HTMLElement>("[data-pick]");
  const filter = target.closest<HTMLElement>("[data-picker-category]");
  const useOutfit = target.closest<HTMLElement>("[data-use-outfit]");
  if (pick?.dataset.pick) {
    const id = pick.dataset.pick;
    if (pickerSelected.has(id)) pickerSelected.delete(id);
    else pickerSelected.add(id);
    showError($("#pickerError"));
    renderPicker();
  } else if (filter) {
    pickerCategory = filter.dataset.pickerCategory ?? "all";
    renderPicker();
  } else if (useOutfit) {
    const outfit = outfits.find((entry) => entry.id === useOutfit.dataset.useOutfit);
    if (outfit) pickerSelected = new Set(outfit.itemIds);
    renderPicker();
  } else if (target.closest("#pickerDelete")) {
    deletePickerRecord();
  } else if (target.closest("#pickerWearToday") && picker.kind === "outfit" && picker.outfit) {
    pickerDialog.close();
    logOutfitToday(picker.outfit);
  }
});
$<HTMLFormElement>("#pickerForm").addEventListener("submit", (event) => {
  event.preventDefault();
  savePicker();
});
$("#taskList").addEventListener("click", (event) => {
  const task = (event.target as Element).closest<HTMLElement>("[data-task]");
  if (task) startTask(task.dataset.task as TaskKind);
});

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
    Object.assign(item, { updatedAt: Date.now(), dirty: true });
    render();
    void persistAndSync(saveItem(item));
    return;
  }
  openDetail(item.id);
});

$("#itemScreen").addEventListener("click", (event) => {
  const item = items.find((entry) => entry.id === viewingItemId);
  if (!item) return;
  const target = event.target as Element;
  if (target.closest("#detailBack")) closeDetail();
  else if (target.closest("#detailEdit")) openItemDialog(item);
  else if (target.closest("#woreTodayButton")) addPieceToToday(item);
  else if (target.closest("#detailFavorite")) {
    item.favorite = !item.favorite;
    Object.assign(item, { updatedAt: Date.now(), dirty: true });
    render();
    void persistAndSync(saveItem(item));
  } else {
    const add = target.closest<HTMLElement>("[data-edit-field]");
    if (add) openItemDialog(item, add.dataset.editField);
  }
});

$("#categoryFilters").addEventListener("click", (event) => {
  const view = (event.target as Element).closest<HTMLButtonElement>("[data-view]");
  if (view) {
    // Tapping the active view again goes back to the whole closet.
    location.hash = tab === view.dataset.view ? "#closet" : `#${view.dataset.view}`;
    return;
  }
  const chip = (event.target as Element).closest<HTMLButtonElement>("[data-category]");
  if (!chip) return;
  if (chip.dataset.category === "all" && tab !== "closet") {
    location.hash = "#closet";
    return;
  }
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
  const files = photoInput.files;
  if (!files?.length) return;
  clearPreviewUrl();
  previewUrl = URL.createObjectURL(files[0]);
  setPhotoPreview(previewUrl, files.length);
});
itemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const label = saveButton.textContent;
  saveButton.disabled = true;
  formError.hidden = true;
  try {
    await saveFromForm();
  } catch (error) {
    console.error(error);
    // The banner sits under the open sheet, so photo errors are shown inside it.
    formError.textContent = "Couldn’t read that photo. Try a JPG, PNG or WebP image.";
    formError.hidden = false;
  } finally {
    saveButton.disabled = false;
    if (itemDialog.open) saveButton.textContent = label;
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
  renderChipOptions($("#weatherField"), "weather", WEATHER);
  renderChipOptions($("#occasionField"), "occasions", OCCASIONS);
  try {
    await loadState();
  } catch (error) {
    console.error(error);
    showToast({ kind: "error", title: "Storage is off", message: "This browser can’t save your closet, so changes will be lost on refresh." });
  }
  applyHash(location.hash);
  initAccount(showToast);
  // Changes pulled from the cloud (or a sign-out clearing this device) reload everything from IndexedDB.
  void startSync({
    onDataChanged: async () => {
      await loadState();
      render();
    }
  });
}

async function loadState() {
  const [storedItems, storedCollections, legacyNames, storedLog, storedOutfits, storedLogs] = await Promise.all([
    loadItems(),
    loadMeta<Collection[]>("collections"),
    loadMeta<string[]>("categories"),
    loadMeta<TaskLog>("taskLog"),
    loadRecords("outfits"),
    loadRecords("wearLogs")
  ]);
  items = storedItems.filter((item) => !item.deletedAt);
  outfits = storedOutfits.filter((outfit) => !outfit.deletedAt);
  wearLogs = storedLogs.filter((log) => !log.deletedAt);
  if (storedCollections) {
    collections = storedCollections;
  } else {
    // First run, or the pre-sync list of names: turn it into records that can sync.
    const now = Date.now();
    collections = (legacyNames ?? DEFAULT_CATEGORIES).map((name, position) => ({ id: newId(), name, position, updatedAt: now, dirty: true }));
    void persist(saveMeta("collections", collections));
  }
  taskLog = storedLog ?? emptyTaskLog("");
  refreshCategories();
}

function refreshCategories() {
  const named = collections
    .filter((collection) => !collection.deletedAt)
    .sort((a, b) => a.position - b.position)
    .map((collection) => collection.name);
  // Keep every piece's collection listed, even one that arrived before its collection record.
  categories = [...named, ...new Set(items.map((item) => item.category).filter((name) => !named.includes(name)))];
}

void init();
