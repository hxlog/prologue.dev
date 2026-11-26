import { notFound } from "next/navigation";
import { compareDesc } from "date-fns";
import { getSortedTags } from "../../../lib/tag-counts";
import { getCachedPosts } from "../../../lib/content/cached";
import { tagLabel } from "../../../../data/tagLabels";
import { readingTimeLabel } from "../../../lib/date";
import PostGrid from "../../../components/post-grid";
import RouteTransition from "../../../components/route-transition";
import JsonLd from "../../../components/json-ld";
import {
  breadcrumbJsonLd,
  collectionPageJsonLd,
} from "../../../lib/structured-data";
import { absoluteUrl, buildMetadata, defaultOgImage } from "../../../lib/seo";

/**
 * One tag archive.
 *
 * The persistent chrome — the full-width header, the tag sidebar and the grid
 * columns — moved to ../layout.js, so this page only renders what is allowed to
 * change on a tag switch: the structured data and the card grid. The full
 * content docs are mapped to the same slim objects PostsLayout passes to
 * PostGrid for /blog, keeping the RSC payload of a switch small.
 *
 * generateStaticParams/generateMetadata/notFound stay exactly as before: every
 * tag is still prerendered into its own HTML file with a real title (crawler /
 * no-JS contract), and navigation between them is still a client-side RSC swap.
 */

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
  if (!getSortedTags().includes(slug)) notFound();
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

export default function Tag({ params }) {
  return <TagArchive params={params} />;
}

async function TagArchive({ params }) {
  const slug = slugOf(await params);
  const posts = (await getCachedPosts()).filter((post) =>
    (post.tags || []).includes(slug),
  );
  if (posts.length === 0) {
    notFound();
  }

  const sorted = [...posts].sort((a, b) =>
    compareDesc(new Date(a.publishDate), new Date(b.publishDate)),
  );

  const label = tagLabel(slug);
  const url = absoluteUrl(`/tags/${slug}`);

  // Same mapping PostsLayout applies for /blog: only these fields cross into
  // the client boundary.
  const slimPosts = sorted
    .filter((post) => post.draft !== true)
    .map((post) => ({
      slug: post.slug,
      title: post.title,
      description: post.description || "",
      publishDate: post.publishDate,
      tags: post.tags || [],
      readingTime: readingTimeLabel(post.readingTime),
    }));

  return (
    <>
      <JsonLd
        data={collectionPageJsonLd({
          title: label,
          description: `标签「${label}」下的所有文章`,
          url,
          items: sorted
            .filter((post) => post.draft !== true)
            .map((post) => ({ name: post.title, path: post.slug })),
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "首页", path: "/" },
          { name: `标签「${label}」`, path: `/tags/${slug}` },
        ])}
      />
      {/* Only the cards are inside the route transition: the header and the
          sidebar belong to the persistent layout and must not be snapshotted
          or faded during a tag switch. */}
      <RouteTransition>
        <div className="page-enter">
          <PostGrid posts={slimPosts} />
        </div>
      </RouteTransition>
    </>
  );
}
