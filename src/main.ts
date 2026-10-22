import "./styles.css";

type Status = "Available" | "Needs review";
type Garment = "tee" | "shirt" | "pants" | "coat";

interface ClosetItem {
  id: number;
  name: string;
  category: string;
  brand: string;
  color: string;
  status: Status;
  garment?: Garment;
  image?: string;
  favorite: boolean;
}

const demoItems: ClosetItem[] = [
  { id: 1, name: "Essential cotton tee", category: "Tops", brand: "Sample piece", color: "Ink black", status: "Needs review", garment: "tee", favorite: false },
  { id: 2, name: "Relaxed overshirt", category: "Tops", brand: "Sample piece", color: "Sage green", status: "Needs review", garment: "shirt", favorite: false },
  { id: 3, name: "Wide-leg trousers", category: "Bottoms", brand: "Sample piece", color: "Charcoal", status: "Needs review", garment: "pants", favorite: false },
  { id: 4, name: "Everyday chore coat", category: "Outerwear", brand: "Sample piece", color: "Clay brown", status: "Needs review", garment: "coat", favorite: false }
];

let items: ClosetItem[] = [...demoItems];
let activeCategory = "all";
let activeStatus = "all";
let currentView = "grid";

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

const grid = $<HTMLDivElement>("#itemGrid");
const emptyState = $<HTMLDivElement>("#emptyState");
const searchInput = $<HTMLInputElement>("#searchInput");
const itemDialog = $<HTMLDialogElement>("#itemDialog");
const itemForm = $<HTMLFormElement>("#itemForm");
const photoInput = $<HTMLInputElement>("#photoInput");

function renderItems() {
  const query = searchInput.value.trim().toLowerCase();
  const visibleItems = items.filter((item) => {
    const matchesText = [item.name, item.category, item.brand, item.color].join(" ").toLowerCase().includes(query);
    const matchesCategory = activeCategory === "all" || item.category === activeCategory;
    const matchesStatus = activeStatus === "all" || item.status === activeStatus;
    return matchesText && matchesCategory && matchesStatus;
  });

  grid.classList.toggle("list-view", currentView === "list");
  grid.innerHTML = visibleItems.map((item) => `
    <article class="item-card">
      <div class="item-card-image">
        ${item.image ? `<img src="${item.image}" alt="${escapeHtml(item.name)}">` : `<div class="sample-garment ${item.garment || "tee"}" aria-hidden="true"></div>`}
        <span class="tag">${item.status === "Available" ? "Cataloged" : "Sample · review"}</span>
        <button class="heart-button ${item.favorite ? "active" : ""}" data-favorite="${item.id}" type="button" aria-label="${item.favorite ? "Remove from favorites" : "Add to favorites"}">${item.favorite ? "♥" : "♡"}</button>
      </div>
      <div class="item-details"><h3>${escapeHtml(item.name)}</h3><div class="item-meta"><span class="brand-name">${escapeHtml(item.brand)} · ${escapeHtml(item.color)}</span><span class="status-pill ${item.status === "Needs review" ? "review" : ""}">${item.status}</span></div></div>
    </article>`).join("");

  emptyState.hidden = visibleItems.length > 0;
  $("#visibleCount").textContent = String(visibleItems.length).padStart(2, "0");
  updateSummary();
  grid.querySelectorAll<HTMLButtonElement>("[data-favorite]").forEach((button) => button.addEventListener("click", () => {
    const item = items.find((entry) => entry.id === Number(button.dataset.favorite));
    if (!item) return;
    item.favorite = !item.favorite;
    renderItems();
  }));
}

function updateSummary() {
  const count = items.length;
  const reviewCount = items.filter((item) => item.status === "Needs review").length;
  $("#itemStat").textContent = String(count).padStart(2, "0");
  $("#missingStat").textContent = String(reviewCount).padStart(2, "0");
  $("#allCount").textContent = String(count);
  $("#favoriteCount").textContent = String(items.filter((item) => item.favorite).length);
  $("#topsCount").textContent = String(items.filter((item) => item.category === "Tops").length);
  $("#bottomsCount").textContent = String(items.filter((item) => item.category === "Bottoms").length);
  $("#outerwearCount").textContent = String(items.filter((item) => item.category === "Outerwear").length);
  const uploaded = items.filter((item) => item.image).length;
  const progress = Math.round((uploaded / Math.max(count, 1)) * 100);
  $("#progressLabel").textContent = `${progress}%`;
  $("#progressBar").style.width = `${progress}%`;
}

const htmlEscapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" };

function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>'"]/g, (char) => htmlEscapes[char]);
}

$("#filterButton").addEventListener("click", () => {
  const row = $("#filterRow");
  row.hidden = !row.hidden;
});
document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => button.addEventListener("click", () => {
  activeCategory = button.dataset.filter ?? "all";
  document.querySelectorAll("[data-filter]").forEach((chip) => chip.classList.toggle("active", chip === button));
  renderItems();
}));
document.querySelectorAll<HTMLButtonElement>("[data-status]").forEach((button) => button.addEventListener("click", () => {
  activeStatus = button.dataset.status ?? "all";
  document.querySelectorAll("[data-status]").forEach((chip) => chip.classList.toggle("active", chip === button));
  renderItems();
}));
searchInput.addEventListener("input", renderItems);
document.querySelectorAll<HTMLButtonElement>(".view-button").forEach((button) => button.addEventListener("click", () => {
  currentView = button.dataset.view ?? "grid";
  document.querySelectorAll(".view-button").forEach((view) => view.classList.toggle("active", view === button));
  renderItems();
}));
$("#resetButton").addEventListener("click", () => {
  searchInput.value = "";
  activeCategory = "all";
  activeStatus = "all";
  document.querySelectorAll<HTMLButtonElement>(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.filter === "all" || chip.dataset.status === "all"));
  renderItems();
});

$("#addItemButton").addEventListener("click", () => itemDialog.showModal());
$("#uploadButton").addEventListener("click", () => itemDialog.showModal());
$<HTMLInputElement>("#hiddenUploadInput").addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  files.forEach((file) => addUploadedItem(file));
  input.value = "";
});
photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  if (file) {
    $(".upload-zone strong").textContent = file.name;
    $(".upload-zone span:last-of-type").textContent = "Ready to add as a catalog image";
  }
});

function addUploadedItem(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    items.unshift({ id: Date.now() + Math.random(), name: file.name.replace(/\.[^/.]+$/, "") || "New garment", category: "Tops", brand: "To identify", color: "To identify", status: "Needs review", image: reader.result as string, favorite: false });
    renderItems();
  };
  reader.readAsDataURL(file);
}

itemForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(itemForm);
  const file = photoInput.files?.[0];
  const field = (name: string) => (formData.get(name) as string | null) || "";
  const item: ClosetItem = { id: Date.now(), name: field("name") || "Untitled garment", category: field("category"), brand: field("brand") || "To identify", color: field("color") || "To identify", status: "Needs review", garment: "tee", favorite: false };
  if (file) {
    const reader = new FileReader();
    reader.onload = () => { item.image = reader.result as string; items.unshift(item); finishSave(); };
    reader.readAsDataURL(file);
  } else { items.unshift(item); finishSave(); }
  function finishSave() { itemForm.reset(); $(".upload-zone strong").textContent = "Drop a garment photo here"; $(".upload-zone span:last-of-type").textContent = "or click to browse · JPG, PNG, WEBP"; itemDialog.close(); renderItems(); }
});

renderItems();
