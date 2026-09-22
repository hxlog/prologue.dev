import { getPosts } from "../lib/content";
import siteMetadata from "../../data/sitemetadata";
import { getSortedTags } from "../lib/tag-counts";

export default async function sitemap() {
  const blogs = getPosts()
    .filter((post) => post.draft === false)
    .map((post) => ({
      url: `${siteMetadata.siteUrl}${post.slug}`,
      lastModified: post.lastmod ? post.lastmod : post.publishDate,
    }));

  const routes = ['', '/blog', '/about'].map((route) => ({
    url: `${siteMetadata.siteUrl}${route}`,
    lastModified: new Date().toISOString().split('T')[0],
  }));

  const tags = getSortedTags().map((tag) => ({
    url: `${siteMetadata.siteUrl}/tags/${tag}`,
    lastModified: new Date().toISOString().split('T')[0],
  }));

  return [...routes, ...tags, ...blogs];
}
