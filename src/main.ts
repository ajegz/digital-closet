import "./styles.css";
import { icons, type IconName } from "./icons";
import { processPhoto } from "./photos";
import { initAccount } from "./account";
import { loadItems, loadMeta, removeItem, saveItem, saveMeta } from "./storage";
import { isSignedIn, requestSync, startSync } from "./sync";
import { OCCASIONS, UNKNOWN, WEATHER, type ClosetItem, type Collection, type Garment, type Occasion, type Status, type Weather } from "./types";

type Tab = "closet" | "favorites" | "recent" | "collections";
type EmptyAction = "add" | "reset" | "closet";

const DEFAULT_CATEGORIES = ["Tops", "Bottoms", "Outerwear", "Dresses", "Accessories"];
const UNTITLED = "Untitled piece";
const RECENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const XP_PER_LEVEL = 100;
// Until the closet holds this many pieces, "add new pieces" stays on the task ladder.
const STARTER_CLOSET = 20;
const MAX_TASKS = 3;
const TOAST_MS = 5000;
const COLLECTION_COLORS = ["var(--leaf)", "var(--sky)", "var(--grape)", "var(--flame)", "var(--berry)", "var(--sun-ledge)"];
const TAB_TITLES: Record<Tab, string> = { closet: "Closet", favorites: "Favorites", recent: "Recent", collections: "Collections" };
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

/* ---------- Today's tasks: a ladder built from what the closet is missing, easiest first ---------- */

type TaskKind = "photo" | "confirm" | "add" | "describe";

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
    { kind: "photo", target: Math.min(1, missingPhoto), done: log.photo },
    { kind: "confirm", target: Math.min(2, needsReview), done: log.confirm },
    { kind: "add", target: starter ? 3 : 0, done: log.add },
    { kind: "describe", target: Math.min(3, undescribed), done: log.describe }
  ];
  const labels: Record<TaskKind, (count: number) => string> = {
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
  if (kind === "add") {
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
  // Back/forward while the sheet is open should leave the sheet, like a native app.
  if (itemDialog.open) itemDialog.close();

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
    tab = name === "favorites" || name === "recent" || name === "collections" ? name : "closet";
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
  const onCollections = tab === "collections";
  $("#itemScreen").hidden = !viewing;
  $("#closetScreen").hidden = Boolean(viewing) || onCollections;
  $("#collectionsScreen").hidden = Boolean(viewing) || !onCollections;
  $("#dashboard").hidden = tab !== "closet" || activeCategory !== "all";
  $("#screenTitle").textContent = viewing ? "Piece" : TAB_TITLES[tab];
  document.querySelectorAll<HTMLAnchorElement>(".tab").forEach((link) => {
    if (link.dataset.tab === tab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  renderStats();
  if (viewing) renderDetail(viewing);
  else if (onCollections) renderCollections();
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

  $("#detailCareText").innerHTML = item.care
    ? escapeHtml(item.care)
    : `<button class="detail-add" type="button" data-edit-field="care">Add care notes</button>`;
}

function renderStats() {
  const count = items.length;
  const xp = totalXp();
  const level = levelFor(xp);
  const levelXp = xp % XP_PER_LEVEL;

  $("#todayLabel").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  $("#greeting").textContent = count ? `${plural(count, "piece")} and counting` : "Let’s fill your closet";
  $("#levelBadge").textContent = `Lv ${level}`;
  $("#xpBar").style.width = `${levelXp}%`;
  $("#xpToNext").textContent = `${levelXp} / ${XP_PER_LEVEL} XP to level ${level + 1}`;

  $("#xpCount").textContent = String(xp);
  $("#xpPill").setAttribute("aria-label", `${xp} XP, level ${level}`);
  renderTasks();

  const withPhotos = items.filter((item) => item.image).length;
  const latest = Math.max(0, ...items.map((item) => item.updatedAt));
  $("#itemStat").textContent = String(count);
  $("#missingStat").textContent = String(items.filter((item) => item.status === "Needs review").length);
  $("#photoStat").textContent = `${count ? Math.round((withPhotos / count) * 100) : 0}%`;
  $("#lastUpdatedStat").textContent = latest ? relativeDay(latest) : "—";
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

function bumpXp() {
  const pill = $("#xpPill");
  pill.classList.remove("is-bump");
  void pill.offsetWidth;
  pill.classList.add("is-bump");
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

function celebrate(xpBefore: number, tasksDoneBefore: boolean, fallback: { title: string; message: string }) {
  const xpAfter = totalXp();
  const xpGained = xpAfter - xpBefore;
  if (levelFor(xpAfter) > levelFor(xpBefore)) {
    showToast({ title: `Level ${levelFor(xpAfter)}!`, message: "Your closet is leveling up.", xp: xpGained });
  } else if (!tasksDoneBefore && allTasksDone()) {
    showToast({ title: "Today’s tasks done!", message: "Your closet is in better shape than this morning.", xp: xpGained > 0 ? xpGained : undefined });
  } else {
    showToast({ ...fallback, xp: xpGained > 0 ? xpGained : undefined });
  }
}

async function saveFromForm() {
  const details = readDetails(new FormData(itemForm));
  const files = Array.from(photoInput.files ?? []);
  const existing = items.find((entry) => entry.id === editingId);
  const xpBefore = totalXp();
  const tasksDoneBefore = allTasksDone();

  if (!existing && files.length > 1) {
    await saveMany(files, details, xpBefore, tasksDoneBefore);
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
  bumpXp();
  celebrate(xpBefore, tasksDoneBefore, existing
    ? { title: "Saved", message: `${item.name} is up to date.` }
    : { title: "Nice!", message: `${item.name} is in your closet.` });
  await persistAndSync(saveItem(item));
}

async function saveMany(files: File[], details: ReturnType<typeof readDetails>, xpBefore: number, tasksDoneBefore: boolean) {
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
  bumpXp();
  celebrate(xpBefore, tasksDoneBefore, { title: `${created.length} pieces added`, message: "Open each one to fill in the details." });
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
  const [storedItems, storedCollections, legacyNames, storedLog] = await Promise.all([
    loadItems(),
    loadMeta<Collection[]>("collections"),
    loadMeta<string[]>("categories"),
    loadMeta<TaskLog>("taskLog")
  ]);
  items = storedItems.filter((item) => !item.deletedAt);
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
