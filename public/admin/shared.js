import { mediaUrl, thumbUrl } from "../format.js";

export const $ = (id) => document.getElementById(id);

// ---------- helpers ----------
export async function j(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("auth");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function toast(msg, isErr = false) {
  const d = document.createElement("div");
  d.className = "toast" + (isErr ? " err" : "");
  d.textContent = msg;
  $("toasts").append(d);
  setTimeout(() => d.remove(), 3200);
}

export function fmtMAD(minor) {
  if (minor == null) return "—";
  return `${Number(minor / 100).toLocaleString("en-US").replace(/\.00$/, "")} MAD`;
}

export function fmtDate(v) {
  return (v || "").slice(0, 10) || "—";
}

export function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function phaseBadge(phase) {
  const map = {
    active: ["b-green", "Active"], trial: ["b-blue", "Trial"],
    trial_ending: ["b-yellow", "Trial ending"], trial_ended: ["b-red", "Trial ended"],
    due_soon: ["b-yellow", "Due soon"], due_today: ["b-yellow", "Due today"],
    grace: ["b-yellow", "Grace"], overdue: ["b-red", "Overdue"],
    paused: ["b-gray", "Paused"], churned: ["b-gray", "Churned"],
    unconfigured: ["b-gray", "No plan"],
  };
  const [cls, label] = map[phase] || ["b-gray", phase || "—"];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

export function supplierStatusBadge(status) {
  const map = { active: ["b-green", "Active"], pending: ["b-yellow", "Pending"], paused: ["b-red", "Paused"] };
  const [cls, label] = map[status] || ["b-gray", status || "—"];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

export function dueText(s) {
  if (s.phase === "trial" || s.phase === "trial_ending" || s.phase === "trial_ended") {
    return `trial ends ${fmtDate(s.trial_ends_at)}`;
  }
  if (s.next_due_at) return `due ${fmtDate(s.next_due_at)}`;
  return "no due date";
}

function fallBack(img) {
  img.addEventListener("error", () => {
    const full = img.dataset.full;
    if (full && img.getAttribute("src") !== full) img.src = full;
  });
}

export function thumb(file) {
  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy";
  img.src = thumbUrl(file);
  img.dataset.full = mediaUrl(file);
  fallBack(img);
  return img;
}

// ---------- modal + drawer ----------
let drawerReturnFocus = null;
export function openModal(title, html) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = html;
  $("modal-wrap").hidden = false;
}
export function closeModal() {
  $("modal-wrap").hidden = true;
}

export function openDrawer(title, statusHtml) {
  const opening = $("drawer-wrap").hidden;
  if (opening) drawerReturnFocus = document.activeElement;
  $("drawer-title").textContent = title;
  $("drawer-status").innerHTML = statusHtml || "";
  $("drawer-body").innerHTML = "Loading…";
  $("drawer-wrap").hidden = false;
  document.body.classList.add("supplier-drawer-open");
  $("adm-layout").inert = true;
  if (opening) document.querySelector(".supplier-drawer").focus({ preventScroll: true });
}
export function closeDrawer() {
  $("drawer-wrap").hidden = true;
  document.body.classList.remove("supplier-drawer-open");
  $("adm-layout").inert = false;
  if (drawerReturnFocus?.isConnected && drawerReturnFocus.getClientRects().length) {
    drawerReturnFocus.focus({ preventScroll: true });
  }
  drawerReturnFocus = null;
}

// ---------- nav ----------
const PAGES = ["overview", "queue", "products", "subs", "suppliers", "payments"];
const PAGE_TITLES = { overview: "Overview", queue: "Review queue", products: "Products", subs: "Submissions", suppliers: "Suppliers", payments: "Payments" };

export function go(page) {
  for (const p of PAGES) {
    const sec = $(`page-${p}`);
    if (sec) sec.hidden = p !== page;
  }
  for (const btn of document.querySelectorAll("[data-page]")) {
    const on = btn.dataset.page === page;
    btn.classList.toggle("active", on);
    if (btn.classList.contains("chip")) btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  $("page-title").textContent = PAGE_TITLES[page] || page;
}
