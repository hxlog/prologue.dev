import { getPosts } from "../../lib/content";
import { compareDesc } from "date-fns";
import PostsLayout from "./bloglistlayout";
import { getTagCounts, getSortedTags } from "../../lib/tag-counts";
import JsonLd from "../../components/json-ld";
import {
  breadcrumbJsonLd,
  collectionPageJsonLd,
} from "../../lib/structured-data";
import { absoluteUrl, buildMetadata, siteImage } from "../../lib/seo";
import siteMetadata from "../../../data/sitemetadata";

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

  const page = siteMetadata.pages.archive;
  const url = absoluteUrl("/blog");
  return (
    <>
      <JsonLd
        data={collectionPageJsonLd({
          title: page.title,
          description: page.description,
          url,
          items: posts
            .filter((post) => post.draft !== true)
            .map((post) => ({ name: post.title, path: post.slug })),
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "首页", path: "/" },
          { name: page.title, path: "/blog" },
        ])}
      />
      <PostsLayout
        posts={posts}
        tagCounts={getTagCounts()}
        sortedTags={getSortedTags()}
        title={page.title}
        subtitle={`共 ${posts.filter((p) => p.draft !== true).length} 篇文章`}
      />
    </>
  );
}

export const metadata = buildMetadata({
  title: siteMetadata.pages.archive.title,
  description: siteMetadata.pages.archive.description,
  path: "/blog",
  type: "website",
  image: siteImage(siteMetadata.pages.archive.title),
});
