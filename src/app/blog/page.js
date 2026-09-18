import { compareDesc } from "date-fns";
import PostsLayout from "./bloglistlayout";
import siteMetadata from "../../../data/sitemetadata";
import { getAllPosts } from "../../lib/content/posts";
import { getTagCounts, getTagLabels, getSortedTags } from "../../lib/content/tags";

export default async function Blog() {
  // Independent reads; run them together. `getAllPosts` includes drafts because
  // the layout filters them client-side for the "共 N 篇文章" line, matching
  // what the page did before.
  const [posts, tagCounts, sortedTags, labels] = await Promise.all([
    getAllPosts(),
    getTagCounts(),
    getSortedTags(),
    getTagLabels(),
  ]);

  const sorted = [...posts].sort((a, b) =>
    compareDesc(new Date(a.publishDate), new Date(b.publishDate))
  );

  return (
    <PostsLayout
      posts={sorted}
      tagCounts={tagCounts}
      sortedTags={sortedTags}
      labels={labels}
      title="归档"
      subtitle={`共 ${sorted.filter((p) => p.draft !== true).length} 篇文章`}
    />
  );
}

export const metadata = {
  title: `归档 - ${siteMetadata.publishName}`,
  description: "All posts here! 所有文章在这里！",
  openGraph: {
    title: `归档 - ${siteMetadata.publishName}`,
    description: "All posts here! 所有文章在这里！",
    url: `${siteMetadata.siteUrl}/blog`,
    images: [siteMetadata.cover],
    authors: [siteMetadata.author],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `归档 - ${siteMetadata.publishName}`,
    description: "All posts here! 所有文章在这里！",
    images: [siteMetadata.cover],
  },
  locale: siteMetadata.language,
  type: "website",
};
