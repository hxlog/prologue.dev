import siteMetadata from "../../data/sitemetadata";
import { absolutize, ogImageUrl } from "./feed/urls";

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
export const SITE_NAME =
  siteMetadata.siteName || siteMetadata.publishName || siteMetadata.title;
export const OG_LOCALE = String(siteMetadata.language || "zh-CN").replace(
  "-",
  "_",
);

export const FEED_TYPES = {
  "application/rss+xml": "/rss",
  "application/atom+xml": "/atomfeed",
  "application/feed+json": "/jsonfeed",
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

/** The generated 1200x630 card, used when a page has no bespoke image. */
export function defaultOgImage(title = siteMetadata.title, params = {}) {
  return {
    url: ogImageUrl({ title, ...params }),
    width: 1200,
    height: 630,
    alt: `${title} · ${SITE_NAME}`,
  };
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
  robots,
  feedTypes = FEED_TYPES,
} = {}) {
  const url = absoluteUrl(path);
  const images = Array.isArray(image)
    ? image
    : image
      ? [image]
      : [defaultOgImage(title)];
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
