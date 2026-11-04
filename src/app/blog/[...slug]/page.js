import { notFound } from "next/navigation";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import { getPosts } from "../../../lib/content";
import { getCachedPost, getCachedPosts } from "../../../lib/content/cached";
import siteMetadata from "../../../../data/sitemetadata";
import ScrollTopAndComment from "../../../components/scroll";
import TableofContent from "../../../components/toc";
import AboutMe from "../../../components/aboutme";
import TagChips from "../../../components/tag-chips";
import RelatedPosts from "../../../components/related-posts";
import ReadingProgress from "../../../components/reading-progress";
import { OptimizedHTMLRenderer } from "../../../components/optimized-html-renderer";
import RouteTransition from "../../../components/route-transition";
import { ArticleSkeleton } from "../../../components/skeletons";
import { formatDate, readingTimeLabel } from "../../../lib/date";
import { ogImageUrl } from "../../../lib/feed/urls";

const Comments = dynamic(() => import("../../../components/comments"), {
  loading: () => <div className="h-32" aria-hidden />,
});

function slugOf(params) {
  const parts = params?.slug;
  return Array.isArray(parts) ? parts.join("/") : parts;
}

// Non-mutating: the loader returns the shared snapshot, which must not be
// sorted in place.
function getAdjacentPosts(posts, post) {
  const sorted = [...posts].sort(
    (a, b) => new Date(a.publishDate) - new Date(b.publishDate),
  );

  const currentIndex = sorted.findIndex(
    (p) => p.slugAsParams === post.slugAsParams,
  );
  const previousPost = currentIndex > 0 ? sorted[currentIndex - 1] : null;
  const nextPost =
    currentIndex < sorted.length - 1 ? sorted[currentIndex + 1] : null;

  const result = {};
  if (previousPost) {
    result.previousPostTitle = previousPost.title;
    result.previousPostSlug = previousPost.slugAsParams;
  }
  if (nextPost) {
    result.nextPostTitle = nextPost.title;
    result.nextPostSlug = nextPost.slugAsParams;
  }
  return result;
}

/** Params for the OG card: the fields the card renders, or nothing. */
function ogParamsFor(post) {
  return {
    title: post.title,
    date: post.publishDate,
    tags: post.tags || [],
    read: readingTimeLabel(post.readingTime),
  };
}

export async function generateMetadata(props) {
  const post = await getCachedPost(slugOf(await props.params));
  if (!post) return {};

  const ogImage = post.image?.trim()
    ? { url: post.image.trim() }
    : { url: ogImageUrl(ogParamsFor(post)) };

  return {
    title: post.title + " - " + siteMetadata.publishName,
    description: post.description,
    openGraph: {
      url: `/blog/${post.slugAsParams}`,
      title: post.title + " - " + siteMetadata.publishName,
      description: post.description,
      type: "article",
      publishedTime: post.publishDate,
      modifiedTime: post.lastmod || post.publishDate,
      authors: [siteMetadata.author],
      tags: post.tags,
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title + " - " + siteMetadata.publishName,
      description: post.description,
      images: [ogImage.url],
    },
  };
}

export function generateStaticParams() {
  return getPosts().map((post) => ({
    slug: post.slugAsParams.split("/"),
  }));
}

/**
 * Shell first, article behind a boundary. The boundary is what keeps the route
 * prerenderable while `params` is still readable -- see lib/content/cached.js
 * for why the body render behind it is cached rather than repeated per request.
 */
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

export default function PostPage({ params }) {
  return (
    <Suspense fallback={<ArticleSkeleton />}>
      <PostView params={params} />
    </Suspense>
  );
}

async function PostView({ params }) {
  const post = await getCachedPost(slugOf(await params));
  if (!post || post.draft === true) {
    notFound();
  }

  const allPosts = await getCachedPosts();
  const adjacentPosts = getAdjacentPosts(allPosts, post);
  const { html, ...postMeta } = post;
  const ogImage = ogImageUrl(ogParamsFor(post));
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    datePublished: post.publishDate,
    dateModified: post.lastmod,
    headline: post.title,
    image: post.image?.trim() ? [post.image, ogImage] : [ogImage],
    description: post.description,
    author: [
      {
        "@type": "Person",
        name: `${siteMetadata.author}`,
        url: `/about`,
      },
    ],
  };

  const hasHero = Boolean(post.image?.trim());
  const hasDescription = Boolean(post.description);

  return (
    <>
      <RouteTransition>
        <ReadingProgress />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />

        <div className="page-enter gap-10 xl:grid xl:grid-cols-[minmax(0,1fr)_16rem]">
          <article className="prose mx-auto min-w-0 max-w-none py-8">
            <header className="not-prose">
              <div className="flex flex-wrap items-center gap-2 text-sm text-faint">
                <time dateTime={post.publishDate}>
                  {formatDate(post.publishDate)}
                </time>
                <span aria-hidden="true">·</span>
                <span>{post.readingTime.words} 字</span>
                <span aria-hidden="true">·</span>
                <span>{readingTimeLabel(post.readingTime)}</span>
              </div>

              <h1 className="mt-4 text-h1 font-semibold leading-tight tracking-tight text-foreground sm:text-display">
                {post.title}
              </h1>

              {hasDescription && (
                <p className="mt-3 text-lead text-muted">
                  {post.description}
                </p>
              )}

              {post.tags?.length ? (
                <div className="mt-4">
                  <TagChips tags={post.tags} />
                </div>
              ) : null}

              {hasHero ? (
                <Image
                  src={post.image.trim()}
                  width={1920}
                  height={1080}
                  alt={"封面 " + post.title}
                  preload
                  fetchPriority="high"
                  sizes="(min-width: 1280px) 896px, (min-width: 768px) 85vw, 100vw"
                  className="my-6 h-auto w-full rounded-card object-cover shadow-card"
                />
              ) : null}
              {post.imageDesc ? (
                <p className="text-sm text-faint">{post.imageDesc}</p>
              ) : null}
            </header>

            <OptimizedHTMLRenderer htmlContent={html} />

            {post.lastmod ? (
              <p className="mt-6 text-sm text-faint">
                最后更新于 {formatDate(post.lastmod)}
              </p>
            ) : null}

            <div className="not-prose mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-sm text-faint">
              <Link
                href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
                target="_blank"
                className="transition-colors duration-(--duration-fast) hover:text-accent"
              >
                CC BY-NC-SA 4.0
              </Link>
              <Link
                href={`https://github.com/${siteMetadata.github}/${siteMetadata.siteRepo}/blob/master/data/content${post.urlslug}.md`}
                target="_blank"
                className="transition-colors duration-(--duration-fast) hover:text-accent"
              >
                在 GitHub 上查看
              </Link>
            </div>

            <Suspense fallback={<div className="h-32" aria-hidden />}>
              <Comments />
            </Suspense>

            <div className="not-prose">
              <RelatedPosts
                post={postMeta}
                allPosts={allPosts}
                excludeSlugs={[
                  adjacentPosts.previousPostSlug,
                  adjacentPosts.nextPostSlug,
                ].filter(Boolean)}
              />
            </div>

            <nav className="not-prose mt-10 flex flex-col justify-between gap-6 border-t border-border pt-6 sm:flex-row">
              {adjacentPosts.previousPostSlug ? (
                <Link
                  href={`/blog/${adjacentPosts.previousPostSlug}`}
                  prefetch={true}
                  className="group max-w-sm"
                >
                  <p className="text-xs uppercase tracking-wide text-faint">
                    上一篇
                  </p>
                  <p className="mt-1 text-sm text-muted transition-colors duration-(--duration-fast) group-hover:text-accent">
                    {adjacentPosts.previousPostTitle}
                  </p>
                </Link>
              ) : (
                <span />
              )}
              {adjacentPosts.nextPostSlug ? (
                <Link
                  href={`/blog/${adjacentPosts.nextPostSlug}`}
                  prefetch={true}
                  className="group max-w-sm sm:text-right"
                >
                  <p className="text-xs uppercase tracking-wide text-faint">
                    下一篇
                  </p>
                  <p className="mt-1 text-sm text-muted transition-colors duration-(--duration-fast) group-hover:text-accent">
                    {adjacentPosts.nextPostTitle}
                  </p>
                </Link>
              ) : null}
            </nav>
          </article>

          {/* The TOC is the sticky element, not the whole column: the author
              card scrolls up out of the way and the outline stays pinned while
              the reader is in the article. It has to be a direct child of the
              aside (the grid row is full article height) — nested one level
              deeper, its sticky range would end at the card's bottom. */}
          <aside className="hidden xl:block">
            <div className="pt-10">
              <AboutMe />
            </div>
            <div className="sticky-below-nav toc-panel mt-10">
              <h2 className="section-label">目录</h2>
              <div className="mt-3">
                <TableofContent headings={post.headings} />
              </div>
              <Link href="/" className="link mt-6 inline-block text-sm">
                ← 返回首页
              </Link>
            </div>
          </aside>
        </div>
      </RouteTransition>

      <ScrollTopAndComment />
    </>
  );
}
