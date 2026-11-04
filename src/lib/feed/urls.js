import siteMetadata from "../../../data/sitemetadata";
import { readingTimeLabel } from "../date";

const SITE = String(siteMetadata.siteUrl || "").replace(/\/+$/, "");

// Bump when the card's visual language changes. The /og response sends
// `s-maxage=31536000, immutable`, so a card URL that stays the same keeps
// serving the old artwork from social-platform and browser caches for up to a
// year; the version parameter is what makes the redesign reach those caches.
const OG_VERSION = "4";

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
 * Dynamic OG image URL.
 *
 * Accepts either a bare title (legacy call shape — a feed-style title) or
 * `{ title, date, tags, read }`, which is what a post passes and what the OG
 * card renders. Every value is encoded individually: a title with `&`, `#` or
 * `+` (all common in Chinese titles) would otherwise truncate or corrupt the
 * query string, and an unencoded `/` in a tag would split the path.
 */
export function ogImageUrl(input) {
  const params =
    typeof input === "string" || input == null
      ? { title: input || "" }
      : input;

  const search = new URLSearchParams();
  if (params.title) search.set("title", String(params.title));
  if (params.date) search.set("date", String(params.date));
  if (params.read) search.set("read", String(params.read));
  search.set("v", OG_VERSION);
  if (Array.isArray(params.tags) && params.tags.length) {
    search.set("tags", params.tags.join(","));
  }

  const query = search.toString();
  return query ? `${SITE}/og?${query}` : `${SITE}/og`;
}

/** Resolve a post cover image, falling back to the OG image generator. */
export function coverImageUrl(post) {
  const image = String(post.image || "").trim();
  if (!image) {
    return ogImageUrl({
      title: post.title,
      date: post.publishDate,
      tags: post.tags,
      read: readingTimeLabel(post.readingTime),
    });
  }
  return absolutize(image);
}
