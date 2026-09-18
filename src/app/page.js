import siteMetadata from "../../data/sitemetadata";
import AboutMe from "../components/aboutme";
import Articles from "../components/articles";
import MicroblogSnippet from "../components/microblog-snippet";
import TerminalQuotes from "../components/terminal-quotes";
import PageTransition from "../components/page-transition";
import { getAllPosts } from "../lib/content/posts";
import { getSortedTags, getTagLabels } from "../lib/content/tags";
import { getMicroblogQuotes } from "../lib/content/collections";

export default async function Home() {
  // The four reads are independent, so they run together rather than in
  // sequence: the page needs posts, the tag list, the Chinese tag labels the
  // cards render, and the sidebar quotes — none depends on another.
  const [posts, sortedTags, labels, quotes] = await Promise.all([
    getAllPosts(),
    getSortedTags(),
    getTagLabels(),
    getMicroblogQuotes(),
  ]);

  // The client <Articles> browser only needs the card fields; mapping here
  // keeps the RSC payload small instead of shipping every post's headings and
  // rendered HTML into the client tree.
  const articles = posts.map((post) => ({
    title: post.title,
    description: post.description,
    draft: post.draft,
    featured: post.featured,
    slug: post.slug,
    tags: post.tags,
    publishDate: post.publishDate,
    readingTime: post.readingTime?.text,
  }));

  // Top-3 tags by post count (sortedTags is already count-desc); fewer if the
  // taxonomy is small.
  const topTags = sortedTags.slice(0, 3);

  return (
    <div className="relative">
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
          <Articles articles={articles} topTags={topTags} labels={labels} />
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
