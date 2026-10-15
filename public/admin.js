import { $, j, toast, go, closeDrawer, closeModal } from "./admin/shared.js";
import { createCatalog } from "./admin/catalog.js";
import { createSuppliers } from "./admin/suppliers.js";
import { createSubmissions } from "./admin/submissions.js";
import { createOverview } from "./admin/overview.js";

let overview;
const catalog = createCatalog({ refreshAll: () => refreshAll(), loadStats: () => overview.loadStats() });
const suppliers = createSuppliers({ catalog, refreshAll: () => refreshAll() });
const submissions = createSubmissions({ catalog, suppliers });
overview = createOverview({ catalog, suppliers });
const preview = $("preview");


for (const btn of document.querySelectorAll("[data-page]")) {
  btn.addEventListener("click", () => go(btn.dataset.page));
}
for (const btn of document.querySelectorAll("[data-go]")) {
  btn.addEventListener("click", () => go(btn.dataset.go));
}
$("drawer-close").addEventListener("click", closeDrawer);
$("drawer-backdrop").addEventListener("click", closeDrawer);
$("modal-backdrop").addEventListener("click", closeModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("modal-wrap").hidden) closeModal();
  else if (event.key === "Escape" && !$("drawer-wrap").hidden) closeDrawer();
});
$("refresh").addEventListener("click", () => refreshAll().catch((e) => toast(e.message, true)));
$("logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login";
});

document.addEventListener("mouseover", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLImageElement) || target.id === "preview" || !target.dataset.full) return;
  preview.src = target.dataset.full;
  preview.hidden = false;
  const width = 300, height = 300;
  let x = event.clientX + 16, y = event.clientY + 16;
  if (x + width > window.innerWidth) x = event.clientX - width - 16;
  if (y + height > window.innerHeight) y = Math.max(8, event.clientY - height - 16);
  preview.style.left = `${x}px`;
  preview.style.top = `${y}px`;
});
document.addEventListener("mousemove", (event) => {
  if (preview.hidden) return;
  const width = 300, height = 300;
  let x = event.clientX + 16, y = event.clientY + 16;
  if (x + width > window.innerWidth) x = event.clientX - width - 16;
  if (y + height > window.innerHeight) y = Math.max(8, event.clientY - height - 16);
  preview.style.left = `${x}px`;
  preview.style.top = `${y}px`;
});
document.addEventListener("mouseout", (event) => {
  if (event.target instanceof HTMLImageElement && event.target.id !== "preview") preview.hidden = true;
});


catalog.init();
suppliers.init();
submissions.init();

async function fillCategories() {
  const categories = await j("/api/categories");
  const select = $("f-category");
  select.replaceChildren(new Option("— Select —", ""));
  for (const name of categories) select.append(new Option(name, name));
}

async function refreshAll() {
  await suppliers.loadSuppliers();
  await Promise.all([overview.loadStats(), overview.loadPayments(), catalog.loadChannels(), catalog.loadPublished(), catalog.loadPosts(true), submissions.loadSubs(true)]);
}

try {
  catalog.setConfig(await j("/api/config"));
  await fillCategories();
  await refreshAll();
  go("overview");
} catch (err) {
  if (err.message !== "auth") catalog.setNote(err.message || "Could not load");
}
