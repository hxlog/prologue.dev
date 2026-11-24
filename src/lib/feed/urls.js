import siteMetadata from "../../../data/sitemetadata.js";
import {
  OG_DEFAULT_KEY,
  ogImagePathWithVersion,
  ogKeyForPath,
  ogKeyForPost,
  isValidOgKey,
} from "../og/keys.js";

const SITE = String(siteMetadata.siteUrl || "").replace(/\/+$/, "");

/** Absolute site origin without a trailing slash. */
export function siteUrl() {
  return SITE;
}

/**
 * Turn a relative path into an absolute URL.
 * Leaves already-absolute, protocol-relative, data:, mailto:, tel: and
 * in-page anchors untouched.
 */
export function absolutize(path) {
  if (!path) return path;
  const value = String(path).trim();
  if (/^(https?:|mailto:|tel:|data:)/i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("#")) return value;
  return value.startsWith("/") ? `${SITE}${value}` : `${SITE}/${value}`;
}

/** Canonical, permanent URL for a post. Used as both id and link. */
export function postUrl(slug) {
  const value = String(slug || "");
  return `${SITE}${value.startsWith("/") ? "" : "/"}${value}`;
}

/**
 * Absolute URL of a pre-rendered OG card.
 *
 * Cards are build-time PNGs under `public/og/<key>.png` (see
 * scripts/build-og-images.mjs and ./og/keys.js). The `?v=` query is ignored by
 * static hosts for file resolution; it only busts social-network/browser caches
 * when OG_IMAGE_VERSION changes (the old route used `?v=` the same way).
 */
export function ogImageUrlForKey(key) {
  const safeKey = isValidOgKey(key) ? key : OG_DEFAULT_KEY;
  return `${SITE}${ogImagePathWithVersion(safeKey)}`;
}

/**
 * Resolve a card key from the shapes callers already have:
 *
 *   { key }          explicit (preferred)
 *   { path }         public page path, e.g. "/blog/a-post", "/tags/AI"
 *   { slugAsParams } post slug
 *   bare title / no locator -> the site-wide default card
 *
 * The title-only legacy shape (`/og?title=…`) has no stable key: a title is
 * content, so it is not a URL. Callers with a post/page should pass a locator;
 * see src/lib/seo.js (buildMetadata derives the key from `path`).
 */
export function ogImageKeyFor(input) {
  if (!input) return OG_DEFAULT_KEY;
  if (typeof input === "string") return OG_DEFAULT_KEY;
  if (input.key) return isValidOgKey(input.key) ? input.key : OG_DEFAULT_KEY;
  if (input.path) return ogKeyForPath(input.path);
  if (input.slugAsParams) return ogKeyForPost(input.slugAsParams);
  return OG_DEFAULT_KEY;
}

/** Absolute OG image URL from any of the locator shapes above. */
export function ogImageUrl(input) {
  return ogImageUrlForKey(ogImageKeyFor(input));
}

/** Resolve a post cover image, falling back to its pre-rendered OG card. */
export function coverImageUrl(post) {
  const image = String(post.image || "").trim();
  if (image) return absolutize(image);
  if (post.slugAsParams) return ogImageUrlForKey(ogKeyForPost(post.slugAsParams));
  return ogImageUrl({ title: post.title });
}
