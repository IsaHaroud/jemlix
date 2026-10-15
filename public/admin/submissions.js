import { $, j, toast, thumb } from "./shared.js";

export function createSubmissions({ catalog, suppliers }) {
  let submissionsRequestId = 0;
  let subs = [];
  let subsOffset = 0;
  let subsTotal = 0;

  async function loadSubs(reset) {
    const requestId = ++submissionsRequestId;
    if (reset) {
      subsOffset = 0;
      subs = [];
    }
    const params = new URLSearchParams({
      status: $("sub-status").value,
      supplier_id: $("sub-supplier").value,
      offset: String(subsOffset),
      limit: "30",
    });
    const data = await j(`/api/submissions?${params}`);
    if (requestId !== submissionsRequestId) return;
    subs = reset ? data.items || [] : subs.concat(data.items || []);
    subsOffset = subs.length;
    subsTotal = data.total || 0;
    renderSubs();
  }

  function renderSubs() {
    const box = $("subs");
    box.replaceChildren();
    const badge = $("subs-badge");
    const fresh = suppliers.list().reduce((n, s) => n + (s.new_submissions || 0), 0);
    for (const item of [badge, $("subs-badge-mobile")]) {
      item.hidden = !fresh;
      item.textContent = fresh ? String(fresh) : "";
    }
    if (!subs.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Nothing here";
      box.append(p);
    }
    for (const sub of subs) {
      const row = document.createElement("div");
      row.className = "sub-row";
      const subImages = parseImages(sub);
      if (subImages[0]) {
        const img = thumb(subImages[0]);
        img.className = "q-img";
        row.append(img);
      }
      const copy = document.createElement("div");
      copy.className = "sub-copy";
      const meta = document.createElement("span");
      meta.className = "q-meta";
      const supp = suppliers.supplierById(sub.supplier_id);
      meta.textContent = [supp?.name || `#${sub.supplier_id}`, subImages.length > 1 ? `${subImages.length} photos` : "", sub.status, sub.id ? `#${sub.id}` : ""].filter(Boolean).join(" · ");
      const txt = document.createElement("div");
      txt.className = "sub-text";
      txt.textContent = (sub.text || "").slice(0, 300) || "(no text)";
      copy.append(meta, txt);
      const actions = document.createElement("div");
      actions.className = "sub-actions";
      const add = document.createElement("button");
      add.type = "button";
      add.className = "primary";
      add.textContent = "Add to catalog";
      add.addEventListener("click", () => catalog.buildFromSubmission(sub, suppliers.supplierById(sub.supplier_id), parseImages(sub)));
      const skipBtn = document.createElement("button");
      skipBtn.type = "button";
      skipBtn.className = "ghost";
      skipBtn.textContent = "Skip";
      skipBtn.addEventListener("click", async () => {
        await j("/api/submissions/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [sub.id], status: "skipped" }),
        });
        toast("Skipped");
        await loadSubs(true);
        await suppliers.loadSuppliers();
      });
      actions.append(add, skipBtn);
      row.append(copy, actions);
      box.append(row);
    }
    $("subs-more").hidden = subs.length >= subsTotal;
  }

  // Every image attached to a submission: the images[] array (albums) with a
  // fallback to the legacy single image column.
  function parseImages(sub) {
    try {
      const arr = typeof sub.images === "string" ? JSON.parse(sub.images) : sub.images;
      if (Array.isArray(arr) && arr.length) return arr.filter((f) => typeof f === "string" && f);
    } catch {
      /* fall through to single image */
    }
    return sub.image ? [sub.image] : [];
  }

  function init() {
    $("subs-refresh").addEventListener("click", () => loadSubs(true).catch((e) => toast(e.message, true)));
    $("sub-status").addEventListener("change", () => loadSubs(true).catch((e) => toast(e.message, true)));
    $("sub-supplier").addEventListener("change", () => loadSubs(true).catch((e) => toast(e.message, true)));
    $("subs-more").addEventListener("click", () => loadSubs(false).catch((e) => toast(e.message, true)));
    $("m-add").addEventListener("click", async () => {
      const err = $("m-error");
      err.hidden = true;
      try {
        await j("/api/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplier_id: Number($("m-supplier").value),
            text: $("m-text").value,
            image: $("m-image").value.trim(),
          }),
        });
        $("m-text").value = "";
        $("m-image").value = "";
        toast("Submission added");
        await loadSubs(true);
        await suppliers.loadSuppliers();
      } catch (e) {
        if (e.message === "auth") return;
        err.hidden = false;
        err.textContent = e.message || "Could not add";
      }
    });
  }
  return { init, loadSubs };
}
