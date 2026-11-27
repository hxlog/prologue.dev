import siteMetadata from "../../data/sitemetadata.js";
import { absolutize, ogImageUrlForKey } from "./feed/urls.js";
import {
  OG_DEFAULT_KEY,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  ogKeyForPath,
} from "./og/keys.js";

/**
 * The single metadata factory for the site.
 *
 * Next merges metadata shallowly: a child that defines `openGraph` replaces the
 * whole parent object, and a child that defines `alternates` replaces the whole
 * parent alternates object. That is why every route calls this helper instead
 * of relying on the root layout's defaults -- otherwise canonical, og:site_name
 * and locale silently disappear on that route.
 */

const SITE = String(siteMetadata.siteUrl || "").replace(/\/+$/, "");

export const SITE_URL = SITE;
export const SITE_NAME = siteMetadata.siteName;
export const OG_LOCALE = String(siteMetadata.language || "zh-CN").replace(
  "-",
  "_",
);

export const FEED_TYPES = {
  "application/rss+xml": "/rss",
  "application/atom+xml": "/atomfeed",
  "application/feed+json": "/jsonfeed",
};

/** Explicit, site-wide indexability plus rich image/snippet previews. */
export const DEFAULT_ROBOTS = {
  index: true,
  follow: true,
  "max-image-preview": "large",
  "max-snippet": -1,
  "max-video-preview": -1,
};

/** Absolute URL for a site path. The home page intentionally has no slash. */
export function absoluteUrl(path = "/") {
  if (!path) return SITE;
  const value = String(path).trim();
  if (/^https?:\/\//i.test(value)) return value;
  const normalized = value.startsWith("/") ? value : `/${value}`;
  return normalized === "/" ? SITE : `${SITE}${normalized}`;
}

/**
 * The static 1600x800 cover used by the home page and archive.
 * SVG template covers have no intrinsic PNG dimensions, so they omit them
 * rather than claiming a size the file may not have.
 */
export function siteImage(title = "") {
  const url = absolutize(siteMetadata.cover);
  if (!url) return defaultOgImage(title);
  const isBitmap = /\.(png|jpe?g|webp)$/i.test(url);
  return {
    url,
    ...(isBitmap ? { width: 1600, height: 800 } : {}),
    alt: title ? `${title} · ${SITE_NAME}` : SITE_NAME,
  };
}

/**
 * Which descriptors were built by defaultOgImage(). A WeakMap (not a property on
 * the object) keeps metadata serialisable: Next validates image descriptors, and
 * a card descriptor that leaks to a metadata export unrewritten (e.g. a direct
 * `siteImage()` fallback) must still be a plain { url, width, height, alt }.
 */
const OG_CARD_IMAGES = new WeakMap();

/**
 * The generated 1200x630 card, used when a page has no bespoke image.
 *
 * The returned descriptor is marked so buildMetadata() can replace its URL with
 * the card key derived from the route path (one pre-rendered PNG per page). When
 * used outside buildMetadata() the url is the site-wide default card.
 */
export function defaultOgImage(title = siteMetadata.siteName, params = {}) {
  const descriptor = {
    url: ogImageUrlForKey(params.key || OG_DEFAULT_KEY),
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    alt: `${title} · ${SITE_NAME}`,
  };
  OG_CARD_IMAGES.set(descriptor, { title, key: params.key || null });
  return descriptor;
}

/**
 * Resolve a card descriptor to the pre-rendered PNG for this route.
 *
 * The page path is the locator: /blog/<slug> -> post-<slug>, /tags/<slug> ->
 * tag-<slug>, /about -> page-about, / -> default. Explicit custom images pass
 * through untouched.
 */
function resolveOgCard(image, path) {
  const marked = OG_CARD_IMAGES.get(image);
  if (!marked) return image;
  return { ...image, url: ogImageUrlForKey(marked.key || ogKeyForPath(path)) };
}

/**
 * Build a complete metadata object for one route.
 *
 * @param {object} options
 * @param {string} options.title       Raw page title (root template adds the suffix).
 * @param {boolean} [options.absoluteTitle] Home page only: do not add the suffix.
 * @param {string} [options.description]
 * @param {string} [options.path]      Site path, e.g. "/blog".
 * @param {"website"|"article"} [options.type]
 * @param {object|object[]} [options.image] OpenGraph image descriptor(s).
 * @param {object} [options.article]   publishedTime/modifiedTime/tags/section.
 * @param {string[]} [options.keywords]
 * @param {object} [options.robots]
 * @param {object} [options.feedTypes] Override the feed alternate map.
 */
export function buildMetadata({
  title,
  absoluteTitle = false,
  description = siteMetadata.description,
  path = "/",
  type = "website",
  image,
  article,
  keywords,
  robots = DEFAULT_ROBOTS,
  feedTypes = FEED_TYPES,
} = {}) {
  const url = absoluteUrl(path);
  const images = (
    Array.isArray(image) ? image : image ? [image] : [defaultOgImage(title)]
  ).map((descriptor) => resolveOgCard(descriptor, path));
  const fullTitle = absoluteTitle ? title : `${title} - ${SITE_NAME}`;

  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    keywords: keywords || siteMetadata.keywords,
    alternates: {
      canonical: url,
      types: feedTypes,
    },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: SITE_NAME,
      locale: OG_LOCALE,
      type,
      images,
      ...(article
        ? {
            publishedTime: article.publishedTime,
            modifiedTime: article.modifiedTime,
            authors: [absoluteUrl("/about")],
            tags: article.tags,
            section: article.section,
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: images.map(({ url: imageUrl, alt }) => ({
        url: imageUrl,
        ...(alt ? { alt } : {}),
      })),
    },
    ...(robots ? { robots } : {}),
  };
}
