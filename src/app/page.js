import { getPosts } from "../lib/content";
import { compareDesc } from "date-fns";
import siteMetadata from "../../data/sitemetadata";
import AboutMe from "../components/aboutme";
import Articles from "../components/articles";
import MicroblogSnippet from "../components/microblog-snippet";
import TerminalQuotes from "../components/terminal-quotes";
import PageTransition from "../components/page-transition";
import RouteTransition from "../components/route-transition";
import { getSortedTags } from "../lib/tag-counts";
import { getMicroblog } from "../lib/microblog";

/**
 * Short quotes for the terminal block. Reads through the same loader as the
 * microblog page and feed -- this used to be a second, independent reader of
 * the same YAML file that swallowed its own errors, so a broken entry silently
 * emptied the block instead of failing.
 */
function getMicroblogQuotes() {
  return getMicroblog()
    .map((entry) => entry.paragraphs[0] || "")
    .filter((text) => text.length >= 8)
    .slice(0, 8)
    .map((text) => (text.length > 64 ? text.slice(0, 64) + "…" : text));
}

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
      readingTime: post.readingTime?.text,
    }));

  // Top-3 tags by post count (sortedTags desc); fewer if the taxonomy is small.
  const topTags = getSortedTags().slice(0, 3);

  const quotes = getMicroblogQuotes();

  return (
    <div className="relative">
      <RouteTransition>
        <PageTransition>
          <section className="mx-auto max-w-3xl pt-16 pb-8">
            <p className="eyebrow">{siteMetadata.title}</p>
            <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
              {siteMetadata.headerTitle}
            </h1>
            <p className="mt-4 font-serif text-lg leading-8 text-foreground/70">
              {siteMetadata.description}
            </p>
          </section>
        </PageTransition>

        <div className="max-w-7xl pt-8 lg:grid lg:grid-cols-9 lg:gap-8">
          <PageTransition className="col-span-7 max-w-4xl pt-6">
            <Articles articles={posts} topTags={topTags} />
          </PageTransition>

          <div className="col-span-2 mx-auto max-w-lg">
            <div
              className="sticky pt-10"
              style={{ top: "calc(var(--nav-height) + 1rem)" }}
            >
              <AboutMe />
              {quotes.length > 0 && <TerminalQuotes quotes={quotes} />}
              <MicroblogSnippet />
            </div>
          </div>
        </div>
      </RouteTransition>
    </div>
  );
}

export const metadata = {
  title: siteMetadata.title,
  description: siteMetadata.description,
  openGraph: {
    title: siteMetadata.title,
    description: siteMetadata.description,
    url: siteMetadata.siteUrl,
    images: [siteMetadata.cover],
    authors: [siteMetadata.author],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: siteMetadata.title,
    description: siteMetadata.description,
    images: [siteMetadata.cover],
  },
  locale: siteMetadata.language,
  type: "website",
};
