import { displayName, isSubstantialName, priceLabel, suggestedName } from "../format.js";
import { $, j, toast, thumb, go } from "./shared.js";

export function createCatalog({ refreshAll, loadStats }) {
  // ---------- shared state ----------
  const supplierEl = $("supplier");
  const statusEl = $("status");
  const channelEl = $("channel");
  const queryEl = $("q");
  const queueEl = $("queue");
  const moreEl = $("more");
  const selCount = $("sel-count");
  const noteEl = $("queue-note");
  const countsEl = $("counts");
  const publishedEl = $("published");
  const emptyEl = $("empty");
  const editor = $("editor");
  const formError = $("form-error");

  const selected = new Map();
  let loaded = [];
  let offset = 0;
  let total = 0;
  let counts = { new: 0, done: 0, skipped: 0 };
  let cfg = { defaultWhatsapp: "", defaultChannel: "" };
  let selImages = [];
  let contactType = "whatsapp";
  let contactVal = "";
  let specs = [];
  let tiers = [];
  let imgOffset = 0;
  let imgTotal = 0;
  let imgQuery = "";
  let imgTimer = 0;
  let queueQueryTimer = 0;
  let productQueryTimer = 0;
  let postsRequestId = 0;
  let productsRequestId = 0;
  let saving = false;
  let pendingSubmissionIds = [];
  let pendingSupplierId = null;
  let editingId = null;
  let lastPublished = [];
  let statsCache = null;

  function setNote(text) {
    noteEl.hidden = !text;
    noteEl.textContent = text || "";
  }

  function resetEditorState() {
    selected.clear();
    pendingSubmissionIds = [];
    pendingSupplierId = null;
    editingId = null;
    tiers = [];
    renderTiers();
    $("edit-badge").hidden = true;
    $("publish").textContent = "Publish";
  }

  function syncPriceMode() {
    const onRequest = $("f-por").checked;
    $("f-price").disabled = onRequest;
    $("btn-add-tier").disabled = onRequest;
    $("tiers").hidden = onRequest;
    $("admin-tier-hint").hidden = !onRequest;
  }

  function renderCounts() {
    countsEl.textContent = `New ${counts.new} · Published ${statsCache?.products.published ?? 0}`;
  }

  function renderSelection() {
    selCount.textContent = `${selected.size} selected`;
    $("clear").parentElement.hidden = selected.size === 0;
  }

  // ---------- queue ----------
  function renderQueue() {
    queueEl.replaceChildren();
    if (!loaded.length) {
      const empty = document.createElement("p");
      empty.className = "queue-empty";
      empty.textContent = supplierEl.value ? "No posts match these filters." : "Select a supplier to view posts.";
      queueEl.append(empty);
    }
    for (const post of loaded) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "q-item";
      if (selected.has(post.id)) button.classList.add("sel");
      if (post.status === "done") button.classList.add("done");
      if (post.status === "skipped") button.classList.add("skipped");
      button.addEventListener("click", () => toggle(post));

      const tick = document.createElement("span");
      tick.className = "tick";
      const text = document.createElement("span");
      text.className = "q-copy";
      const line = document.createElement("span");
      line.className = "q-text";
      const raw = (post.text || "").trim();
      line.textContent = raw ? raw.slice(0, 90) : "(no text)";
      const meta = document.createElement("span");
      meta.className = "q-meta";
      const state = post.status === "done" ? "published" : post.status === "skipped" ? "skipped" : "";
      meta.textContent = [post.date?.slice(0, 10) || "", state].filter(Boolean).join(" · ");
      text.append(line, meta);

      button.append(tick);
      if (post.image) {
        const img = thumb(post.image);
        img.className = "q-img";
        button.append(img);
      } else {
        const blank = document.createElement("span");
        blank.className = "q-img blank";
        button.append(blank);
      }
      button.append(text);
      queueEl.append(button);
    }
    moreEl.hidden = loaded.length >= total;
    moreEl.textContent = `Show more (${Math.max(total - loaded.length, 0)} left)`;
  }

  function toggle(post) {
    if (selected.has(post.id)) selected.delete(post.id);
    else selected.set(post.id, post);
    renderSelection();
    renderQueue();
  }

  async function loadPosts(reset) {
    const requestId = ++postsRequestId;
    if (reset) {
      offset = 0;
      loaded = [];
    }
    if (!supplierEl.value) {
      counts = { new: 0, done: 0, skipped: 0 };
      total = 0;
      moreEl.hidden = true;
      renderQueue();
      renderSelection();
      renderCounts();
      setNote("");
      return;
    }
    setNote("");
    const params = new URLSearchParams({
      supplier_id: supplierEl.value,
      status: statusEl.value,
      channel: channelEl.value,
      q: queryEl.value.trim(),
      offset: String(offset),
      limit: "40",
    });
    const data = await j(`/api/posts?${params}`);
    if (requestId !== postsRequestId) return;
    counts = data.counts || counts;
    total = data.total || 0;
    loaded = reset ? data.items || [] : loaded.concat(data.items || []);
    offset = loaded.length;
    renderQueue();
    renderSelection();
    renderCounts();
  }

  async function loadChannels() {
    const channels = await j("/api/channels");
    const current = channelEl.value;
    channelEl.replaceChildren(new Option("All channels", ""));
    for (const ch of channels) channelEl.append(new Option(ch.name, ch.name));
    channelEl.value = channels.some((ch) => ch.name === current) ? current : "";
    renderChannels(channels);
  }

  function renderChannels(list) {
    const box = $("channels");
    box.replaceChildren();
    for (const ch of list) {
      const row = document.createElement("div");
      row.className = "chan";
      const name = document.createElement("span");
      name.className = "chan-name";
      name.textContent = ch.name;
      const prefix = document.createElement("span");
      prefix.className = "chan-prefix";
      prefix.textContent = "/c/";
      const input = document.createElement("input");
      input.value = ch.slug;
      input.placeholder = "slug";
      input.setAttribute("aria-label", `Slug for ${ch.name}`);
      const save = document.createElement("button");
      save.type = "button";
      save.className = "ghost";
      save.textContent = "Save";
      save.addEventListener("click", () => saveSlug(ch.name, input));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          saveSlug(ch.name, input);
        }
      });
      const count = document.createElement("span");
      count.className = "muted";
      count.textContent = `${ch.count} products`;
      const link = document.createElement("a");
      link.className = "text-link";
      link.href = `/c/${encodeURIComponent(ch.slug)}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "↗";
      row.append(name, prefix, input, save, count, link);
      box.append(row);
    }
  }

  async function saveSlug(name, input) {
    const slug = input.value.trim().toLowerCase();
    try {
      await j("/api/channels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug }),
      });
      await loadChannels();
      setNote("");
      toast("Slug saved");
    } catch (err) {
      if (err.message === "auth") return;
      setNote(err.message || "Could not save slug");
    }
  }

  // ---------- products ----------
  function renderPublished(list) {
    lastPublished = list;
    publishedEl.replaceChildren();
    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = $("pub-supplier").value || $("pub-q").value.trim()
        ? "No products match these filters."
        : "No products yet.";
      publishedEl.append(empty);
      return;
    }
    for (const product of list) {
      const row = document.createElement("div");
      row.className = "pub";
      if (product.images?.[0]) {
        const img = thumb(product.images[0]);
        img.className = "pub-img";
        row.append(img);
      } else {
        const blank = document.createElement("span");
        blank.className = "pub-img blank";
        row.append(blank);
      }
      const copy = document.createElement("div");
      copy.className = "pub-copy";
      const title = document.createElement("div");
      title.className = "pub-name";
      title.textContent = displayName(product.name);
      const meta = document.createElement("div");
      meta.className = "muted";
      const tierCount = Array.isArray(product.price_tiers) ? product.price_tiers.length : 0;
      const bits = [product.category, product.price_on_request ? "Price on request" : priceLabel(product.price, "MAD"), product.source_channel].filter(Boolean);
      if (tierCount && !product.price_on_request) bits.push(`${tierCount} price tiers`);
      if (!isSubstantialName(product.name)) bits.push("weak name");
      if (!product.published) bits.push("draft");
      meta.textContent = bits.join(" · ");
      copy.append(title, meta);
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "ghost";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => editProduct(product.id));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      del.textContent = "Delete";
      del.addEventListener("click", () => removeProduct(product.id, del));
      const actions = document.createElement("div");
      actions.className = "pub-actions";
      actions.append(edit, del);
      row.append(copy, actions);
      publishedEl.append(row);
    }
  }

  async function loadPublished() {
    const requestId = ++productsRequestId;
    const params = new URLSearchParams({
      supplier_id: $("pub-supplier").value,
      q: $("pub-q").value.trim(),
    });
    const products = await j(`/api/admin/products?${params}`);
    if (requestId === productsRequestId) renderPublished(products);
  }

  async function removeProduct(id, button) {
    if (button.dataset.confirm !== "1") {
      button.dataset.confirm = "1";
      button.textContent = "Confirm delete";
      setTimeout(() => {
        if (button.dataset.confirm === "1") {
          delete button.dataset.confirm;
          button.textContent = "Delete";
        }
      }, 5000);
      return;
    }
    await j(`/api/products/${id}`, { method: "DELETE" });
    toast("Product deleted");
    await Promise.all([loadStats(), loadPublished(), loadPosts(true)]);
  }

  function editProduct(id) {
    const product = lastPublished.find((p) => p.id === id);
    if (!product) return;
    resetEditorState();
    setNote("");
    editingId = id;
    pendingSupplierId = product.supplier_id ?? null;
    selImages = [...(product.images || [])];
    emptyEl.hidden = true;
    editor.hidden = false;
    const badge = $("edit-badge");
    badge.hidden = false;
    badge.textContent = `Editing product #${id}${product.published ? "" : " (draft)"}`;
    $("publish").textContent = product.published ? "Save" : "Publish";
    $("post-text").textContent = product.description || "(no description)";
    $("post-phone").hidden = true;
    $("f-name").value = product.name || "";
    $("f-category").value = product.category || "";
    $("f-price").value = product.price || "";
    $("f-por").checked = !!product.price_on_request;
    syncPriceMode();
    $("f-stock").value = product.stock || "";
    $("f-moq").value = product.moq || "";
    $("f-desc").value = product.description || "";
    specs = (product.specs || []).map((s) => ({ k: s.k || "", v: s.v || "" }));
    renderSpecs();
    tiers = (product.price_tiers || []).map((tr) => ({ min_qty: tr.min_qty ?? "", max_qty: tr.max_qty ?? "", price: tr.price || "" }));
    renderTiers();
    $("source").textContent = product.source_channel || "";
    formError.hidden = true;
    $("picker").hidden = true;
    renderSelImages();
    renderContact([], product.contact_type ? { type: product.contact_type, value: product.contact || "" } : undefined);
    go("queue");
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
    $("f-name").focus();
  }

  // ---------- editor images / specs / contact ----------
  function renderSelImages() {
    const box = $("sel-images");
    $("img-count").textContent = String(selImages.length);
    box.replaceChildren();
    for (const file of selImages) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sel-img";
      button.title = "Remove image";
      button.append(thumb(file));
      button.addEventListener("click", () => {
        selImages = selImages.filter((item) => item !== file);
        renderSelImages();
        syncPickerSelection();
      });
      box.append(button);
    }
  }

  function syncPickerSelection() {
    for (const button of $("img-grid").querySelectorAll("button")) {
      button.classList.toggle("sel", selImages.includes(button.dataset.file));
    }
  }

  async function loadImages(reset) {
    if (reset) imgOffset = 0;
    const params = new URLSearchParams({ q: imgQuery, offset: String(imgOffset), limit: "40" });
    const data = await j(`/api/images?${params}`);
    imgTotal = data.total || 0;
    const grid = $("img-grid");
    if (reset) grid.replaceChildren();
    for (const file of data.items || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.file = file;
      if (selImages.includes(file)) button.classList.add("sel");
      button.append(thumb(file));
      button.addEventListener("click", () => {
        if (selImages.includes(file)) selImages = selImages.filter((item) => item !== file);
        else if (selImages.length < 12) selImages.push(file);
        renderSelImages();
        syncPickerSelection();
      });
      grid.append(button);
    }
    imgOffset = grid.children.length;
    $("img-more").hidden = imgOffset >= imgTotal;
  }

  function renderContact(phones, preselect) {
    const box = $("contact-options");
    box.replaceChildren();
    const extra = preselect?.value &&
      ![cfg.defaultWhatsapp, phones[0] || "", cfg.defaultChannel, ""].includes(preselect.value)
      ? [{ type: preselect.type, label: `Saved ${preselect.value}`, value: preselect.value, disabled: false }]
      : [];
    const options = [
      {
        type: "whatsapp",
        label: cfg.defaultWhatsapp ? `Default WhatsApp ${cfg.defaultWhatsapp}` : "Default WhatsApp",
        value: cfg.defaultWhatsapp,
        disabled: !cfg.defaultWhatsapp,
      },
      {
        type: "whatsapp-msg",
        label: phones[0] ? `Post WhatsApp ${phones[0]}` : "Post WhatsApp",
        value: phones[0] || "",
        disabled: !phones[0],
      },
      { type: "telegram", label: "Telegram channel", value: cfg.defaultChannel, disabled: !cfg.defaultChannel },
      { type: "none", label: "No contact", value: "", disabled: false },
      ...extra,
    ];
    const picked = preselect && options.find((o) => !o.disabled && o.type === preselect.type && o.value === preselect.value);
    const first = picked || options.find((option) => !option.disabled) || options[3];
    for (const option of options) {
      const label = document.createElement("label");
      label.className = "choice";
      if (option.disabled) label.classList.add("disabled");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "contact";
      input.disabled = option.disabled;
      input.checked = option === first;
      input.addEventListener("change", () => {
        contactType = option.type;
        contactVal = option.value;
      });
      const span = document.createElement("span");
      span.textContent = option.label;
      label.append(input, span);
      box.append(label);
    }
    contactType = first.type;
    contactVal = first.value;
  }

  function addSpecRow(k, v) {
    specs.push({ k: k || "", v: v || "" });
    renderSpecs();
  }

  function renderSpecs() {
    const box = $("specs");
    box.replaceChildren();
    specs.forEach((spec, i) => {
      const row = document.createElement("div");
      row.className = "spec-row";
      const key = document.createElement("input");
      key.placeholder = "Attribute (e.g. Color)";
      key.value = spec.k;
      key.addEventListener("input", () => { spec.k = key.value; });
      const value = document.createElement("input");
      value.placeholder = "Value (e.g. Red)";
      value.value = spec.v;
      value.addEventListener("input", () => { spec.v = value.value; });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      del.textContent = "✕";
      del.addEventListener("click", () => { specs.splice(i, 1); renderSpecs(); });
      row.append(key, value, del);
      box.append(row);
    });
  }

  function addTierRow(minQty, maxQty, price) {
    tiers.push({ min_qty: minQty ?? "", max_qty: maxQty ?? "", price: price ?? "" });
    renderTiers();
  }

  function renderTiers() {
    const box = $("tiers");
    if (!box) return;
    box.replaceChildren();
    tiers.forEach((tier, i) => {
      const row = document.createElement("div");
      row.className = "tier-row";
      const min = document.createElement("input");
      min.type = "number";
      min.min = "1";
      min.placeholder = "From (pcs)";
      min.setAttribute("aria-label", "From quantity");
      min.value = tier.min_qty;
      min.addEventListener("input", () => { tier.min_qty = min.value; });
      const max = document.createElement("input");
      max.type = "number";
      max.min = "1";
      max.placeholder = "To (empty = ∞)";
      max.setAttribute("aria-label", "To quantity, empty means no limit");
      max.value = tier.max_qty ?? "";
      max.addEventListener("input", () => { tier.max_qty = max.value === "" ? null : max.value; });
      const price = document.createElement("input");
      price.placeholder = "Unit price";
      price.setAttribute("aria-label", "Unit price");
      price.value = tier.price;
      price.addEventListener("input", () => { tier.price = price.value; });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      del.textContent = "✕";
      del.addEventListener("click", () => { tiers.splice(i, 1); renderTiers(); });
      row.append(min, max, price, del);
      box.append(row);
    });
  }

  function buildProduct() {
    resetEditorState();
    if (!selected.size) {
      setNote("Select at least one post");
      return;
    }
    setNote("");
    const posts = [...selected.values()].sort((a, b) => a.msg_id - b.msg_id);
    selImages = posts.map((post) => post.image).filter(Boolean);
    const text = posts.map((post) => post.text).filter(Boolean).join("\n\n──────────\n\n");
    const phones = [...new Set(posts.flatMap((post) => post.phone || []))];
    emptyEl.hidden = true;
    editor.hidden = false;
    $("post-text").textContent = text || "(no text)";
    $("post-phone").hidden = phones.length === 0;
    $("post-phone").textContent = phones.length ? `Numbers in posts: ${phones.join(", ")}` : "";
    $("f-name").value = suggestedName(text);
    $("f-price").value = "";
    $("f-por").checked = false;
    syncPriceMode();
    $("f-stock").value = "";
    $("f-moq").value = "";
    $("f-desc").value = "";
    specs = [];
    renderSpecs();
    tiers = [];
    renderTiers();
    $("source").textContent = posts[0]?.channel || "";
    formError.hidden = true;
    $("picker").hidden = true;
    renderSelImages();
    renderContact(phones);
    $("f-name").focus();
  }

  async function publish(event, asDraft = false) {
    if (event) event.preventDefault();
    if (saving) return;
    const name = $("f-name").value.trim();
    if (!isSubstantialName(name)) {
      formError.hidden = false;
      formError.textContent = "Product name is required";
      return;
    }
    saving = true;
    $("publish").disabled = true;
    $("save-draft").disabled = true;
    const busyBtn = $(asDraft ? "save-draft" : "publish");
    const busyOriginal = busyBtn.textContent;
    busyBtn.textContent = asDraft ? "Saving…" : "Publishing…";
    busyBtn.classList.add("is-loading");
    try {
      const queueSupplier = supplierEl.value && supplierEl.value !== "unlinked" ? Number(supplierEl.value) : null;
      const payload = {
        name,
        category: $("f-category").value,
        price: $("f-por").checked ? "" : $("f-price").value,
        price_on_request: $("f-por").checked,
        stock: $("f-stock").value,
        moq: $("f-moq").value,
        description: $("f-desc").value,
        images: selImages,
        contact: contactVal,
        contact_type: contactType,
        source_channel: $("source").textContent,
        post_ids: [...selected.keys()],
        specs: specs.filter((spec) => spec.k.trim() && spec.v.trim()),
        price_tiers: $("f-por").checked ? [] : tiers,
        published: asDraft ? 0 : 1,
      };
      if (pendingSupplierId) payload.supplier_id = pendingSupplierId;
      else if (queueSupplier) payload.supplier_id = queueSupplier;
      if (pendingSubmissionIds.length) payload.submission_ids = pendingSubmissionIds;
      if (editingId) {
        await j(`/api/products/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast("Product saved");
      } else {
        await j("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast(asDraft ? "Draft saved" : "Product published");
      }
      resetEditorState();
      editor.hidden = true;
      emptyEl.hidden = false;
      await refreshAll();
    } catch (err) {
      if (err.message === "auth") return;
      formError.hidden = false;
      formError.textContent = err.message || "Could not publish";
    } finally {
      saving = false;
      $("publish").disabled = false;
      $("save-draft").disabled = false;
      busyBtn.classList.remove("is-loading");
      if (!editor.hidden) busyBtn.textContent = busyOriginal;
    }
  }

  async function skip() {
    const ids = [...selected.values()].filter((post) => post.status !== "done").map((post) => post.id);
    if (!ids.length) {
      setNote("Published posts only return when you delete the product");
      return;
    }
    await j("/api/posts/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, status: "skipped" }),
    });
    for (const id of ids) selected.delete(id);
    setNote("");
    toast("Skipped");
    await loadPosts(true);
  }


  function buildFromSubmission(sub, supp, images) {
    resetEditorState();
    pendingSubmissionIds = [sub.id];
    pendingSupplierId = sub.supplier_id;
    setNote("");
    // All album photos travel together — never just the first one.
    selImages = images;
    const phones = supp?.whatsapp ? [supp.whatsapp] : [];
    emptyEl.hidden = true;
    editor.hidden = false;
    $("post-text").textContent = sub.text || "(no text)";
    $("post-phone").hidden = phones.length === 0;
    $("post-phone").textContent = phones.length ? `Supplier WhatsApp: ${phones.join(", ")}` : "";
    $("f-name").value = suggestedName(sub.text || "");
    $("f-price").value = "";
    $("f-por").checked = false;
    syncPriceMode();
    $("f-stock").value = "";
    $("f-moq").value = "";
    $("f-desc").value = "";
    specs = [];
    renderSpecs();
    tiers = [];
    renderTiers();
    $("source").textContent = supp?.channel_title || supp?.name || "";
    formError.hidden = true;
    $("picker").hidden = true;
    renderSelImages();
    renderContact(phones);
    go("queue");
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
    $("f-name").focus();
  }

  function init() {
    $("clear").addEventListener("click", () => {
      selected.clear();
      renderSelection();
      renderQueue();
    });
    $("skip").addEventListener("click", () => skip().catch((err) => setNote(err.message)));
    $("build").addEventListener("click", buildProduct);
    $("cancel").addEventListener("click", () => {
      resetEditorState();
      renderSelection();
      renderQueue();
      editor.hidden = true;
      emptyEl.hidden = false;
    });
    editor.addEventListener("submit", (event) => publish(event, false).catch((err) => setNote(err.message)));
    $("save-draft").addEventListener("click", () => publish(null, true).catch((err) => setNote(err.message)));
    $("btn-add-img").addEventListener("click", () => {
      const picker = $("picker");
      picker.hidden = !picker.hidden;
      if (!picker.hidden) {
        imgQuery = "";
        $("img-q").value = "";
        loadImages(true).catch((err) => setNote(err.message));
      }
    });
    $("btn-add-spec").addEventListener("click", () => addSpecRow("", ""));
    $("btn-add-tier").addEventListener("click", () => addTierRow("", null, ""));
    $("f-por").addEventListener("change", syncPriceMode);
    $("img-q").addEventListener("input", () => {
      imgQuery = $("img-q").value.trim();
      clearTimeout(imgTimer);
      imgTimer = setTimeout(() => loadImages(true).catch((err) => setNote(err.message)), 200);
    });
    $("img-more").addEventListener("click", () => loadImages(false).catch((err) => setNote(err.message)));
    $("more").addEventListener("click", () => loadPosts(false).catch((err) => setNote(err.message)));
    queryEl.addEventListener("input", () => {
      clearTimeout(queueQueryTimer);
      queueQueryTimer = setTimeout(() => loadPosts(true).catch((err) => setNote(err.message)), 200);
    });
    statusEl.addEventListener("change", () => loadPosts(true).catch((err) => setNote(err.message)));
    channelEl.addEventListener("change", () => loadPosts(true).catch((err) => setNote(err.message)));
    supplierEl.addEventListener("change", () => {
      selected.clear();
      loadPosts(true).catch((err) => setNote(err.message));
    });
    $("pub-supplier").addEventListener("change", () => loadPublished().catch((e) => toast(e.message, true)));
    $("pub-q").addEventListener("input", () => {
      clearTimeout(productQueryTimer);
      productQueryTimer = setTimeout(() => loadPublished().catch((e) => toast(e.message, true)), 250);
    });
  }

  function setConfig(value) { cfg = value; }
  function setStats(value) { statsCache = value; renderCounts(); }
  return { init, setConfig, setStats, setNote, loadPosts, loadChannels, loadPublished, supplierEl, buildFromSubmission };
}
