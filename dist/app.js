const demoItems = [
  { id: 1, name: "Essential cotton tee", category: "Tops", brand: "Sample piece", color: "Ink black", status: "Needs review", garment: "tee", favorite: false },
  { id: 2, name: "Relaxed overshirt", category: "Tops", brand: "Sample piece", color: "Sage green", status: "Needs review", garment: "shirt", favorite: false },
  { id: 3, name: "Wide-leg trousers", category: "Bottoms", brand: "Sample piece", color: "Charcoal", status: "Needs review", garment: "pants", favorite: false },
  { id: 4, name: "Everyday chore coat", category: "Outerwear", brand: "Sample piece", color: "Clay brown", status: "Needs review", garment: "coat", favorite: false }
];

let items = [...demoItems];
let activeCategory = "all";
let activeStatus = "all";
let currentView = "grid";

const grid = document.querySelector("#itemGrid");
const emptyState = document.querySelector("#emptyState");
const searchInput = document.querySelector("#searchInput");
const itemDialog = document.querySelector("#itemDialog");
const itemForm = document.querySelector("#itemForm");
const photoInput = document.querySelector("#photoInput");

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
  document.querySelector("#visibleCount").textContent = String(visibleItems.length).padStart(2, "0");
  updateSummary();
  grid.querySelectorAll("[data-favorite]").forEach((button) => button.addEventListener("click", () => {
    const item = items.find((entry) => entry.id === Number(button.dataset.favorite));
    item.favorite = !item.favorite;
    renderItems();
  }));
}

function updateSummary() {
  const count = items.length;
  const reviewCount = items.filter((item) => item.status === "Needs review").length;
  document.querySelector("#itemStat").textContent = String(count).padStart(2, "0");
  document.querySelector("#missingStat").textContent = String(reviewCount).padStart(2, "0");
  document.querySelector("#allCount").textContent = count;
  document.querySelector("#favoriteCount").textContent = items.filter((item) => item.favorite).length;
  document.querySelector("#topsCount").textContent = items.filter((item) => item.category === "Tops").length;
  document.querySelector("#bottomsCount").textContent = items.filter((item) => item.category === "Bottoms").length;
  document.querySelector("#outerwearCount").textContent = items.filter((item) => item.category === "Outerwear").length;
  const uploaded = items.filter((item) => item.image).length;
  const progress = Math.round((uploaded / Math.max(count, 1)) * 100);
  document.querySelector("#progressLabel").textContent = `${progress}%`;
  document.querySelector("#progressBar").style.width = `${progress}%`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[char]));
}

document.querySelector("#filterButton").addEventListener("click", () => {
  const row = document.querySelector("#filterRow");
  row.hidden = !row.hidden;
});
document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
  activeCategory = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach((chip) => chip.classList.toggle("active", chip === button));
  renderItems();
}));
document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", () => {
  activeStatus = button.dataset.status;
  document.querySelectorAll("[data-status]").forEach((chip) => chip.classList.toggle("active", chip === button));
  renderItems();
}));
searchInput.addEventListener("input", renderItems);
document.querySelectorAll(".view-button").forEach((button) => button.addEventListener("click", () => {
  currentView = button.dataset.view;
  document.querySelectorAll(".view-button").forEach((view) => view.classList.toggle("active", view === button));
  renderItems();
}));
document.querySelector("#resetButton").addEventListener("click", () => {
  searchInput.value = "";
  activeCategory = "all";
  activeStatus = "all";
  document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.filter === "all" || chip.dataset.status === "all"));
  renderItems();
});

document.querySelector("#addItemButton").addEventListener("click", () => itemDialog.showModal());
document.querySelector("#uploadButton").addEventListener("click", () => itemDialog.showModal());
document.querySelector("#hiddenUploadInput").addEventListener("change", (event) => {
  const files = Array.from(event.target.files || []);
  files.forEach((file) => addUploadedItem(file));
  event.target.value = "";
});
photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  if (file) {
    document.querySelector(".upload-zone strong").textContent = file.name;
    document.querySelector(".upload-zone span:last-of-type").textContent = "Ready to add as a catalog image";
  }
});

function addUploadedItem(file) {
  const reader = new FileReader();
  reader.onload = () => {
    items.unshift({ id: Date.now() + Math.random(), name: file.name.replace(/\.[^/.]+$/, "") || "New garment", category: "Tops", brand: "To identify", color: "To identify", status: "Needs review", image: reader.result, favorite: false });
    renderItems();
  };
  reader.readAsDataURL(file);
}

itemForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(itemForm);
  const file = photoInput.files?.[0];
  const item = { id: Date.now(), name: formData.get("name") || "Untitled garment", category: formData.get("category"), brand: formData.get("brand") || "To identify", color: formData.get("color") || "To identify", status: "Needs review", garment: "tee", favorite: false };
  if (file) {
    const reader = new FileReader();
    reader.onload = () => { item.image = reader.result; items.unshift(item); finishSave(); };
    reader.readAsDataURL(file);
  } else { items.unshift(item); finishSave(); }
  function finishSave() { itemForm.reset(); document.querySelector(".upload-zone strong").textContent = "Drop a garment photo here"; document.querySelector(".upload-zone span:last-of-type").textContent = "or click to browse · JPG, PNG, WEBP"; itemDialog.close(); renderItems(); }
});

renderItems();
