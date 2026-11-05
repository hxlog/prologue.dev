import { getPosts } from "../lib/content";
import { compareDesc } from "date-fns";
import siteMetadata from "../../data/sitemetadata";
import AboutMe from "../components/aboutme";
import Articles from "../components/articles";
import MicroblogSnippet from "../components/microblog-snippet";
import PageTransition from "../components/page-transition";
import RouteTransition from "../components/route-transition";
import { getSortedTags } from "../lib/tag-counts";
import { readingTimeLabel } from "../lib/date";
import { buildMetadata, siteImage } from "../lib/seo";

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

export default function Home() {
  // getPosts() re-reads when the content files change; copy before sorting,
  // since the array it returns is the shared snapshot.
  const posts = [...getPosts()]
    .sort((a, b) => compareDesc(new Date(a.publishDate), new Date(b.publishDate)))
    .map((post) => ({
      title: post.title,
      description: post.description,
      draft: post.draft,
      featured: post.featured,
      slug: post.slug,
      tags: post.tags,
      publishDate: post.publishDate,
      readingTime: readingTimeLabel(post.readingTime),
    }));

  // Top-3 tags by post count (sortedTags desc); fewer if the taxonomy is small.
  const topTags = getSortedTags().slice(0, 3);

  return (
    <div className="relative">
      <RouteTransition>
        <PageTransition>
          <section className="mx-auto max-w-3xl pt-16 pb-10">
            <p className="eyebrow">{siteMetadata.title}</p>
            <h1 className="mt-4 text-display font-semibold leading-tight tracking-tight text-foreground">
              {siteMetadata.headerTitle}
            </h1>
            <p className="mt-4 text-lead text-muted">
              {siteMetadata.description}
            </p>
          </section>
        </PageTransition>

        <div className="pt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-10">
          <PageTransition className="min-w-0 pt-6">
            <Articles articles={posts} topTags={topTags} />
          </PageTransition>

          <aside className="mx-auto w-full max-w-lg lg:mx-0">
            <div className="sticky-below-nav pt-10">
              <AboutMe />
              <MicroblogSnippet />
            </div>
          </aside>
        </div>
      </RouteTransition>
    </div>
  );
}

export const metadata = buildMetadata({
  title: siteMetadata.title,
  absoluteTitle: true,
  description: siteMetadata.description,
  path: "/",
  type: "website",
  image: siteImage(),
});
