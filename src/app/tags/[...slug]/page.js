import { notFound } from "next/navigation";
import { compareDesc } from "date-fns";
import PostsLayout from "../../blog/bloglistlayout";
import siteMetadata from "../../../../data/sitemetadata";
import { getAllPosts } from "../../../lib/content/posts";
import {
  getTagCounts,
  getTagLabels,
  getSortedTags,
  resolveTagSlug,
} from "../../../lib/content/tags";

/**
 * Prerender every known tag page at build time. Unknown tags still resolve at
 * request time and 404 via notFound() — the taxonomy is closed, but a stale
 * link from elsewhere on the web should reach the tag page rather than a
 * build-time error.
 */
export async function generateStaticParams() {
  const sortedTags = await getSortedTags();
  return sortedTags.map((tag) => ({ slug: [tag] }));
}

export async function generateMetadata(props) {
  const params = await props.params;
  const requested = params?.slug?.join("/");
  const slug = await resolveTagSlug(requested);
  const labels = await getTagLabels();
  const label = labels[slug ?? requested] ?? slug ?? requested;

  return {
    title: `${label} - ${siteMetadata.publishName}`,
    description: `标签「${label}」下的所有文章`,
    openGraph: {
      title: `${label} - ${siteMetadata.publishName}`,
      description: `标签「${label}」下的所有文章`,
      url: `${siteMetadata.siteUrl}/tags/${slug ?? requested}`,
      type: "website",
    },
  };
}

export default async function Tag(props) {
  const params = await props.params;
  const requested = params?.slug?.join("/");

  // Resolve aliases first: /tags/Web3 must render the Crypto page rather than
  // 404. next.config.js still issues the 308 for direct navigation; this keeps
  // the page itself correct for crawlers that follow the old URL and for
  // internal links that were never updated.
  const slug = await resolveTagSlug(requested);
  if (!slug) notFound();

  const [allPosts, tagCounts, sortedTags, labels] = await Promise.all([
    getAllPosts(),
    getTagCounts(),
    getSortedTags(),
    getTagLabels(),
  ]);

  const filtered = allPosts.filter(
    (post) => post.draft !== true && (post.tags || []).includes(slug)
  );
  if (filtered.length === 0) {
    notFound();
  }

  const posts = [...filtered].sort((a, b) =>
    compareDesc(new Date(a.publishDate), new Date(b.publishDate))
  );

  const label = labels[slug] ?? slug;

  return (
    <PostsLayout
      posts={posts}
      tagCounts={tagCounts}
      sortedTags={sortedTags}
      labels={labels}
      activeTag={slug}
      title="标签"
      subtitle={`「${label}」下共有 ${posts.length} 篇文章`}
    />
  );
}
