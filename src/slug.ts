// Slug for a channel URL. ASCII only; returns "" for names with no latin
// characters (Arabic, emoji) so the caller can fall back to a numeric slug.
export function slugify(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

// An admin-set slug must be simple and ASCII.
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}
