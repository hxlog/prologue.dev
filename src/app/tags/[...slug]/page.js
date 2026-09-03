import { notFound } from "next/navigation";
import { allPosts } from "contentlayer/generated";
import { compareDesc } from "date-fns";
import PostsLayout from "../../blog/bloglistlayout";
import { tagCounts, sortedTags } from "../../../lib/tag-counts";
import { tagLabel } from "../../../../data/tagLabels";
import siteMetadata from "../../../../data/sitemetadata";

/**
 * Prerender every known tag page at build time (the tag set is a finite,
 * closed list from the taxonomy). This removes the per-request SSR that made
 * /tags/* the worst-TTFB pages on the site. Unknown tags still resolve at
 * request time and 404 via notFound().
 */
export function generateStaticParams() {
  return sortedTags.map((tag) => ({ slug: [tag] }));
}

export async function generateMetadata(props) {
  const params = await props.params;
  const slug = params?.slug?.join("/");
  const label = tagLabel(slug);
  return {
    title: `${label} - ${siteMetadata.publishName}`,
    description: `标签「${label}」下的所有文章`,
    openGraph: {
      title: `${label} - ${siteMetadata.publishName}`,
      description: `标签「${label}」下的所有文章`,
      url: `${siteMetadata.siteUrl}/tags/${slug}`,
      type: "website",
    },
  };
}

export default async function Tag(props) {
  const params = await props.params;
  const slug = params?.slug?.join("/");

  const filtered = allPosts.filter(
    (post) => post.draft !== true && (post.tags || []).includes(slug)
  );
  if (filtered.length === 0) {
    notFound();
  }

  const posts = [...filtered].sort((a, b) =>
    compareDesc(new Date(a.publishDate), new Date(b.publishDate))
  );

  return (
    <PostsLayout
      posts={posts}
      tagCounts={tagCounts}
      sortedTags={sortedTags}
      activeTag={slug}
      title="标签"
      subtitle={`「${tagLabel(slug)}」下共有 ${posts.length} 篇文章`}
    />
  );
}
