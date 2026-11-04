import { notFound } from "next/navigation";
import { Suspense } from "react";
import { compareDesc } from "date-fns";
import PostsLayout from "../../blog/bloglistlayout";
import { getTagCounts, getSortedTags } from "../../../lib/tag-counts";
import { getCachedPosts } from "../../../lib/content/cached";
import { tagLabel } from "../../../../data/tagLabels";
import siteMetadata from "../../../../data/sitemetadata";
import { ArchiveSkeleton } from "../../../components/skeletons";

/**
 * Prerender every known tag page at build time (the tag set is a finite,
 * closed list from the taxonomy). Unknown tags still resolve at request time
 * and 404 via notFound().
 */
export function generateStaticParams() {
  return getSortedTags().map((tag) => ({ slug: [tag] }));
}

export async function generateMetadata(props) {
  const slug = slugOf(await props.params);
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

function slugOf(params) {
  const parts = params?.slug;
  return Array.isArray(parts) ? parts.join("/") : parts;
}

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

export default function Tag({ params }) {
  return (
    <Suspense fallback={<ArchiveSkeleton />}>
      <TagArchive params={params} />
    </Suspense>
  );
}

async function TagArchive({ params }) {
  const slug = slugOf(await params);
  const posts = (await getCachedPosts()).filter((post) =>
    (post.tags || []).includes(slug)
  );
  if (posts.length === 0) {
    notFound();
  }

  const sorted = [...posts].sort((a, b) =>
    compareDesc(new Date(a.publishDate), new Date(b.publishDate))
  );

  return (
    <PostsLayout
      posts={sorted}
      tagCounts={getTagCounts()}
      sortedTags={getSortedTags()}
      activeTag={slug}
      title="标签"
      subtitle={`「${tagLabel(slug)}」下共有 ${sorted.length} 篇文章`}
    />
  );
}
