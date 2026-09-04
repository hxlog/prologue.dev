import { notFound } from "next/navigation";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import { allPosts } from "contentlayer/generated";
import "katex/dist/katex.min.css";
import siteMetadata from "../../../../data/sitemetadata";
import ScrollTopAndComment from "../../../components/scroll";
import TableofContent from "../../../components/toc";
import Link from "next/link";
import Image from "next/image";
import AboutMe from "../../../components/aboutme";
import TagChips from "../../../components/tag-chips";
import RelatedPosts from "../../../components/related-posts";
import ReadingProgress from "../../../components/reading-progress";
import { OptimizedHTMLRenderer } from "../../../components/optimized-html-renderer";
import { formatDate } from "../../../lib/date";

const Comments = dynamic(() => import("../../../components/comments"), {
  loading: () => <div className="h-32" aria-hidden />,
});

async function getPostFromParams(params) {
  const slug = params?.slug?.join("/");
  return allPosts.find((post) => post.slugAsParams === slug);
}

// Non-mutating: allPosts is shared module state and must not be sorted in place.
function getAdjacentPosts(post) {
  const sortedPosts = [...allPosts].sort(
    (a, b) => new Date(a.publishDate) - new Date(b.publishDate),
  );

  const currentIndex = sortedPosts.findIndex((p) => p === post);
  const previousPost = currentIndex > 0 ? sortedPosts[currentIndex - 1] : null;
  const nextPost =
    currentIndex < sortedPosts.length - 1
      ? sortedPosts[currentIndex + 1]
      : null;

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

export async function generateMetadata(props) {
  const params = await props.params;
  const post = await getPostFromParams(params);
  if (!post) return {};

  return {
    title: post.title + " - " + siteMetadata.publishName,
    description: post.description,
    openGraph: {
      url: `/blog/${post.slugAsParams}`,
      title: post.title + " - " + siteMetadata.publishName,
      description: post.description,
      type: "article",
      images: [
        post.image == ""
          ? { url: `/og?title=${post.title}` }
          : { url: post.image },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title + " - " + siteMetadata.publishName,
      description: post.description,
      images: [post.image === null ? `/og?title=${post.title}` : post.image],
    },
  };
}

export async function generateStaticParams() {
  return allPosts.map((post) => ({
    slug: post.slugAsParams.split("/"),
  }));
}

export default async function PostPage(props) {
  const params = await props.params;
  const post = await getPostFromParams(params);
  if (!post || post.draft === true) {
    notFound();
  }

  const adjacentPosts = getAdjacentPosts(post);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    datePublished: post.publishDate,
    dateModified: post.lastmod,
    headline: post.title,
    image:
      post.image == ""
        ? [`/og?title=${post.title}`]
        : [post.image, `/og?title=${post.title}`],
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

  return (
    <>
      <ReadingProgress />
      <section>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </section>

      <div className="page-enter relative mx-auto max-w-7xl gap-8 xl:grid xl:grid-cols-10">
        <article className="prose dark:prose-invert col-span-8 mx-auto max-w-7xl py-8">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <time dateTime={post.publishDate}>
              {formatDate(post.publishDate)}
            </time>
            <span aria-hidden="true">·</span>
            <span>{post.readingTime.words} 字</span>
            <span aria-hidden="true">·</span>
            <span>{post.readingTime.text}</span>
          </div>

          <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
            {post.title}
          </h1>

          {post.description && (
            <p className="mt-3 font-serif text-base leading-7 text-foreground/70">
              {post.description}
            </p>
          )}

          {post.tags?.length ? (
            <div className="mt-4 not-prose">
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
              className="my-6 w-full inset-0 rounded-xl object-cover ring-1 ring-inset ring-border"
              style={{ height: "auto" }}
            />
          ) : null}
          {post.imageDesc != "" ? (
            <p className="text-sm text-faint">{post.imageDesc}</p>
          ) : null}

          <OptimizedHTMLRenderer htmlContent={post.body.html} />

          {post.lastmod ? (
            <p className="mt-6 text-sm text-faint">
              最后更新于 {formatDate(post.lastmod)}
            </p>
          ) : null}

          <Link
            href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
            target="_blank"
          >
            <p className="mt-10 py-2 text-sm text-faint transition-colors duration-300 hover:text-accent">
              CC BY-NC-SA 4.0
            </p>
          </Link>

                    <p className="not-prose py-2 text-right">
            <Link
              href={`https://github.com/${siteMetadata.github}/${siteMetadata.siteRepo}/blob/master/data/content${post.urlslug}.md`}
              target="_blank"
              className="text-sm text-faint transition-colors duration-300 hover:text-accent"
            >
              在 GitHub 上查看
            </Link>
          </p>
          
          <Suspense fallback={<div className="h-32" aria-hidden />}>
            <Comments />
          </Suspense>
          <div className="not-prose">
            <RelatedPosts
              post={post}
              allPosts={allPosts}
              excludeSlugs={[
                adjacentPosts.previousPostSlug,
                adjacentPosts.nextPostSlug,
              ].filter(Boolean)}
            />
          </div>

          <div className="not-prose mt-10 justify-between gap-8 py-4 sm:flex">
            {adjacentPosts.previousPostSlug ? (
              <div className="mb-4 sm:mb-0">
                <p className="text-xs uppercase tracking-wide text-faint">
                  上一篇
                </p>
                <Link
                  href={`/blog/${adjacentPosts.previousPostSlug}`}
                  className="mt-1 block text-sm text-muted transition-colors duration-200 hover:text-accent"
                >
                  {adjacentPosts.previousPostTitle}
                </Link>
              </div>
            ) : (
              <div />
            )}
            {adjacentPosts.nextPostSlug ? (
              <div className="sm:text-right">
                <p className="text-xs uppercase tracking-wide text-faint">
                  下一篇
                </p>
                <Link
                  href={`/blog/${adjacentPosts.nextPostSlug}`}
                  className="mt-1 block text-sm text-muted transition-colors duration-200 hover:text-accent"
                >
                  {adjacentPosts.nextPostTitle}
                </Link>
              </div>
            ) : null}
          </div>


        </article>

        <div className="col-span-2 mx-auto">
          <AboutMe />
          <div
            className="sticky pt-10"
            style={{ top: "calc(var(--nav-height) + 0.5rem)" }}
          >
            <div className="hidden xl:block">
              <h3 className="py-4 pt-0 text-sm font-medium text-muted">目录</h3>
              <TableofContent headings={post.headings} />
            </div>
            <Link href="/">
              <p className="py-2 text-right text-sm text-faint transition-colors duration-300 hover:text-accent sm:text-left">
                ← 返回
              </p>
            </Link>
          </div>
        </div>
      </div>

      <ScrollTopAndComment />
    </>
  );
}
