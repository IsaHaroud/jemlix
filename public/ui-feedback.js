// Tiny vanilla micro-interactions (no framework):
// copy-to-clipboard with fallback, "copied" flash, async loading buttons,
// and double-tap guard for links that open a new tab.
const CHECK_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// Swap a button's content to ✓ + label for ~1.8s, then restore.
export function flashCopied(btn, doneText) {
  if (!btn || btn.dataset.flash === "1") return;
  btn.dataset.flash = "1";
  const original = btn.innerHTML;
  btn.classList.add("is-copied");
  btn.replaceChildren();
  const wrap = document.createElement("span");
  wrap.className = "copied-inner";
  wrap.innerHTML = CHECK_SVG;
  const label = document.createElement("span");
  label.textContent = doneText;
  wrap.append(label);
  btn.append(wrap);
  setTimeout(() => {
    btn.innerHTML = original;
    btn.classList.remove("is-copied");
    delete btn.dataset.flash;
  }, 1800);
}

// Run an async action with the button locked + spinner; label stays put.
export async function withLoading(btn, fn, busyText) {
  if (!btn || btn.dataset.busy === "1") return;
  btn.dataset.busy = "1";
  const original = btn.innerHTML;
  btn.style.minWidth = `${btn.offsetWidth}px`;
  if (busyText) btn.textContent = busyText;
  btn.classList.add("is-loading");
  try {
    if (btn instanceof HTMLButtonElement) btn.disabled = true;
    return await fn();
  } finally {
    btn.innerHTML = original;
    btn.style.minWidth = "";
    btn.classList.remove("is-loading");
    if (btn instanceof HTMLButtonElement) btn.disabled = false;
    delete btn.dataset.busy;
  }
}

// Prevent double-tap from opening two tabs on target=_blank links.
export function guardDoubleTap(link, ms = 1500) {
  link.addEventListener("click", (event) => {
    if (link.dataset.busy === "1") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    link.dataset.busy = "1";
    link.classList.add("is-loading");
    setTimeout(() => {
      delete link.dataset.busy;
      link.classList.remove("is-loading");
    }, ms);
  }, true);
}
