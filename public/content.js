import { getLang, initLang, t } from "./i18n.js";
import { initOwnerContact } from "./owner-contact.js";

function syncContentLanguage() {
  const active = getLang();
  for (const section of document.querySelectorAll("[data-content-lang]")) {
    section.hidden = section.dataset.contentLang !== active;
  }
  const page = document.body.dataset.page;
  if (page === "about" || page === "blog") {
    document.title = t(`${page}Title`);
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute("content", t(`${page}Description`));
  }
}

document.addEventListener("jemla:lang", syncContentLanguage);
initLang();
syncContentLanguage();
initOwnerContact();
