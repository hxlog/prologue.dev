import { getPosts } from "../../lib/content";
import { compareDesc } from "date-fns";
import PostsLayout from "./bloglistlayout";
import siteMetadata from "../../../data/sitemetadata";
import { getTagCounts, getSortedTags } from "../../lib/tag-counts";

/* Cache Components gates (Next 16.4).
   - instant = true: assert that a navigation into this route paints UI
     immediately. Validation runs in development and names the component that
     would block it; the build is unaffected.
   - ensureStatic = "shell": the App Shell for this route must stay prerendered
     at build time. It is a ratchet against a later change quietly turning the
     route request-rendered — the failure mode is a build error, not a slow
     page nobody measures. */
export const instant = true;
export const ensureStatic = "shell";

export default function Blog() {
  // getPosts() re-reads when the content files change; copy before sorting,
  // since the array it returns is the shared snapshot.
  const posts = [...getPosts()].sort((a, b) =>
    compareDesc(new Date(a.publishDate), new Date(b.publishDate))
  );

  return (
    <PostsLayout
      posts={posts}
      tagCounts={getTagCounts()}
      sortedTags={getSortedTags()}
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
