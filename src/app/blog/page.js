import { allPosts } from "contentlayer/generated";
import { compareDesc } from "date-fns";
import PostsLayout from "./bloglistlayout";
import siteMetadata from "../../../data/sitemetadata";
import { tagCounts, sortedTags } from "../../lib/tag-counts";

export default function Blog() {
  // Copy before sorting — allPosts is shared module state.
  const posts = [...allPosts].sort((a, b) =>
    compareDesc(new Date(a.publishDate), new Date(b.publishDate))
  );

  return (
    <PostsLayout
      posts={posts}
      tagCounts={tagCounts}
      sortedTags={sortedTags}
      title="归档"
      subtitle={`共 ${posts.filter((p) => p.draft !== true).length} 篇文章`}
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
