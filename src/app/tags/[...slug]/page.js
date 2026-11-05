import { notFound } from "next/navigation";
import { Suspense } from "react";
import { compareDesc } from "date-fns";
import PostsLayout from "../../blog/bloglistlayout";
import { getTagCounts, getSortedTags } from "../../../lib/tag-counts";
import { getCachedPosts } from "../../../lib/content/cached";
import { tagLabel } from "../../../../data/tagLabels";
import { ArchiveSkeleton } from "../../../components/skeletons";
import JsonLd from "../../../components/json-ld";
import {
  breadcrumbJsonLd,
  collectionPageJsonLd,
} from "../../../lib/structured-data";
import { absoluteUrl, buildMetadata, defaultOgImage } from "../../../lib/seo";

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
  const description = `标签「${label}」下的所有文章`;
  return buildMetadata({
    title: label,
    description,
    path: `/tags/${slug}`,
    type: "website",
    image: defaultOgImage(label),
  });
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

  const label = tagLabel(slug);
  const url = absoluteUrl(`/tags/${slug}`);
  return (
    <>
      <JsonLd
        data={collectionPageJsonLd({
          title: label,
          description: `标签「${label}」下的所有文章`,
          url,
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "首页", path: "/" },
          { name: `标签「${label}」`, path: `/tags/${slug}` },
        ])}
      />
      <PostsLayout
        posts={sorted}
        tagCounts={getTagCounts()}
        sortedTags={getSortedTags()}
        activeTag={slug}
        title="标签"
        subtitle={`「${label}」下共有 ${sorted.length} 篇文章`}
      />
    </>
  );
}
