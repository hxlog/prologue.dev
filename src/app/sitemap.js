import siteMetadata from "../../data/sitemetadata";
import { getPublishedPosts } from "../lib/content/posts";
import { getAllPages } from "../lib/content/pages";
import { getSortedTags } from "../lib/content/tags";

/**
 * Sitemap.
 *
 * `lastModified` for posts is the post's own timestamp, not the build time.
 * The previous version stamped every static route and every tag page with
 * `new Date()` — the moment the site was built — which told crawlers that all
 * 79 URLs changed on every deploy. None of them had.
 *
 * This also has to be deterministic: with `cacheComponents` on, a sitemap that
 * calls `new Date()` outside a cache boundary is a build error, because the
 * output would differ between builds with no input having changed.
 */
export default async function sitemap() {
  const [posts, pages, tags] = await Promise.all([
    getPublishedPosts(),
    getAllPages(),
    getSortedTags(),
  ]);

  const blogEntries = posts.map((post) => ({
    url: `${siteMetadata.siteUrl}${post.slug}`,
    lastModified: post.lastmod ?? post.publishDate,
  }));

  // Static routes carry no lastModified at all rather than a fabricated one.
  // Omitting it is honest; a wrong one is worse than none.
  const staticRoutes = ["", "/blog", "/microblog", "/links"].map((route) => ({
    url: `${siteMetadata.siteUrl}${route}`,
  }));

  const pageEntries = pages.map((page) => ({
    url: `${siteMetadata.siteUrl}/${page.slugAsParams}`,
  }));

  const tagEntries = tags.map((tag) => ({
    url: `${siteMetadata.siteUrl}/tags/${tag}`,
  }));

  return [...staticRoutes, ...pageEntries, ...tagEntries, ...blogEntries];
}
