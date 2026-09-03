import fs from "fs";
import path from "path";
import { load } from "js-yaml";
import { allPosts } from "contentlayer/generated";
import { compareDesc } from "date-fns";
import siteMetadata from "../../data/sitemetadata";
import AboutMe from "../components/aboutme";
import Articles from "../components/articles";
import MicroblogSnippet from "../components/microblog-snippet";
import TerminalQuotes from "../components/terminal-quotes";
import PageTransition from "../components/page-transition";

function getMicroblogQuotes() {
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), "data", "microblog.yaml"),
      "utf8"
    );
    const entries = load(raw) || [];
    return [...entries]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map((e) => String(e.content || ""))
      .filter((c) => c.length >= 8)
      .slice(0, 8)
      .map((c) => (c.length > 64 ? c.slice(0, 64) + "…" : c));
  } catch {
    return [];
  }
}

export default function Home() {
  // Copy before sorting — allPosts is shared module state.
  const posts = [...allPosts]
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

  const tagCount = posts.reduce((acc, article) => {
    (article.tags || []).forEach((tag) => {
      acc[tag] = (acc[tag] || 0) + 1;
    });
    return acc;
  }, {});

  const mostCommonTag = Object.keys(tagCount).reduce(
    (best, tag) => (best === null || tagCount[tag] > tagCount[best] ? tag : best),
    null
  );

  const quotes = getMicroblogQuotes();

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
          <Articles articles={posts} mostCommonTag={mostCommonTag} />
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
