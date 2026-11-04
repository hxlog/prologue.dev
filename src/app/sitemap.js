import { cacheLife } from "next/cache";
import { getPosts } from "../lib/content";
import siteMetadata from "../../data/sitemetadata";
import { getSortedTags } from "../lib/tag-counts";

/**
 * Sitemap.
 *
 * The content URLs carry real per-post dates. The static routes and tag pages
 * used to carry `new Date()` — a synchronous clock read, which Cache Components
 * refuses to prerender, and which was also useless: every run stamped every
 * static route with "today", so the value said nothing about when the page
 * actually changed.
 *
 * They now carry the date of the newest content the page can show — the newest
 * post for /blog and the home page, the newest post under that tag for a tag
 * page. That is the honest last-modified signal for an archive page, and it is
 * derived entirely from frontmatter, so no clock is touched. `/about` is the
 * only entry with no derivable date (its markdown has no publish date), so it
 * simply omits `lastModified`; the sitemap protocol makes the field optional,
 * and omitting is better than a fabricated one.
 *
 * `'use cache'` keeps the whole thing in the static build: the content tree is
 * read once per build, matching how every page consuming it is prerendered.
 */
export default async function sitemap() {
  "use cache";
  cacheLife("max");

  const posts = getPosts().filter((post) => post.draft === false);

  const newestDate = posts.reduce((newest, post) => {
    const date = post.lastmod || post.publishDate;
    return !newest || date > newest ? date : newest;
  }, null);

  const blogEntries = posts.map((post) => ({
    url: `${siteMetadata.siteUrl}${post.slug}`,
    lastModified: post.lastmod ?? post.publishDate,
  }));

  const staticRoutes = ["", "/blog"].map((route) => ({
    url: `${siteMetadata.siteUrl}${route}`,
    ...(newestDate ? { lastModified: newestDate } : {}),
  }));

  // A page with no date in its frontmatter has no date to report.
  staticRoutes.push({ url: `${siteMetadata.siteUrl}/about` });

  const tagEntries = getSortedTags().map((tag) => {
    const newestForTag = posts
      .filter((post) => (post.tags || []).includes(tag))
      .reduce((newest, post) => {
        const date = post.lastmod || post.publishDate;
        return !newest || date > newest ? date : newest;
      }, null);
    return {
      url: `${siteMetadata.siteUrl}/tags/${tag}`,
      ...(newestForTag ? { lastModified: newestForTag } : {}),
    };
  });

  return [...staticRoutes, ...tagEntries, ...blogEntries];
}
