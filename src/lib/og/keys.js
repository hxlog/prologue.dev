/**
 * OG card keys and URL helpers.
 *
 * Cards are pre-rendered at build time into `public/og/<key>.png` by
 * `scripts/build-og-images.mjs`, so every OG image URL is a static asset URL
 * (`/og/<key>.png`) instead of the old query-string route (`/og?title=…`).
 *
 * This module is shared by:
 *   - `scripts/build-og-images.mjs` (which keys to render),
 *   - `src/lib/seo.js` (metadata: page path → key),
 *   - `src/lib/feed/urls.js` (absolute feed/JSON-LD URLs),
 *   - `src/app/sitemap.js` (image sitemap entries).
 *
 * Pure functions, no fs/React/Next imports: safe from a plain Node script.
 */

/** Rewrite of the card's visual language? Bump to invalidate cached URLs. */
export const OG_IMAGE_VERSION = "5";

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** Site-wide fallback card (also the card for the home page / unknown paths). */
export const OG_DEFAULT_KEY = "default";

/** Where every generated card lives, relative to the site root. */
export const OG_PUBLIC_DIR = "/og";

/**
 * A key becomes a file name and a URL segment, so it is restricted to
 * lowercase ASCII with dots/underscores/hyphens: no spaces, no CJK, no slashes.
 */
export function sanitizeOgKeyPart(value) {
  const cleaned = String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  return cleaned || "untitled";
}

/** `post-<slugAsParams>` — the post's canonical catch-all slug. */
export function ogKeyForPost(slugAsParams) {
  return `post-${sanitizeOgKeyPart(slugAsParams)}`;
}

/** `tag-<english-slug>` (tag URLs are already ASCII, see data/tagLabels.js). */
export function ogKeyForTag(tagSlug) {
  return `tag-${sanitizeOgKeyPart(tagSlug)}`;
}

/** `page-<name>` — a markdown page (`about`) or a fixed app page (`ui`). */
export function ogKeyForPage(name) {
  return `page-${sanitizeOgKeyPart(name)}`;
}

/**
 * Derive the card key from a public page path. This is how every metadata call
 * site gets an exact card without having to thread a key through: page files
 * already pass `path` to `buildMetadata()`.
 *
 *   /blog/<slug>   -> post-<slug>
 *   /tags/<slug>   -> tag-<slug>
 *   /microblog     -> page-microblog
 *   /links         -> page-links
 *   /ui            -> page-ui
 *   /about (etc.)  -> page-about
 *   /              -> default
 */
export function ogKeyForPath(pathname) {
  const clean =
    String(pathname ?? "/").split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";

  if (clean === "/") return OG_DEFAULT_KEY;

  // The archive uses the static site cover (siteImage), not a generated card.
  if (clean === "/blog") return OG_DEFAULT_KEY;

  if (clean.startsWith("/blog/")) {
    const rest = clean.slice("/blog/".length);
    // /blog/page/2 and other archive-only paths have no dedicated card.
    if (rest && rest !== "page" && !rest.startsWith("page/")) {
      return ogKeyForPost(rest);
    }
    return OG_DEFAULT_KEY;
  }

  if (clean.startsWith("/tags/")) {
    const rest = clean.slice("/tags/".length);
    return rest ? ogKeyForTag(rest) : OG_DEFAULT_KEY;
  }

  // Every other page-like path is a markdown page under the catch-all route
  // (/about, and future nested pages like /legal/privacy). The generator keys
  // those as page-<segments joined by '-'>.
  return ogKeyForPage(clean.replace(/^\/+/, ""));
}

/** Site-relative path of a card, without the cache-busting query. */
export function ogImagePath(key) {
  return `${OG_PUBLIC_DIR}/${sanitizeOgKeyPart(key)}.png`;
}

/**
 * Site-relative URL of a card with the version query. Static hosts ignore the
 * query for file resolution, so this only busts social/browser caches when the
 * card artwork changes.
 */
export function ogImagePathWithVersion(key) {
  return `${ogImagePath(key)}?v=${OG_IMAGE_VERSION}`;
}

/** Validate a caller-provided key against the same alphabet as the generator. */
export function isValidOgKey(key) {
  return (
    typeof key === "string" &&
    key.length > 0 &&
    key.length <= 120 &&
    /^[a-z0-9][a-z0-9._-]*$/.test(key)
  );
}
