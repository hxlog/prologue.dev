import { notFound } from "next/navigation";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { getPages } from "../../lib/content";
import { getCachedPage } from "../../lib/content/cached";
import { OptimizedHTMLRenderer } from "../../components/optimized-html-renderer";
import siteMetadata from "../../../data/sitemetadata";
import TableofContent from "../../components/toc";
import ScrollTopAndComment from "../../components/scroll";
import PageTransition from "../../components/page-transition";
import RouteTransition from "../../components/route-transition";
import { PageSkeleton } from "../../components/skeletons";
import Portfolio from "../../components/portfolio";
import { ogImageUrl } from "../../lib/feed/urls";

const Comments = dynamic(() => import("../../components/comments"), {
  loading: () => <div className="h-32" aria-hidden />,
});

function slugOf(params) {
  const parts = params?.slug;
  return Array.isArray(parts) ? parts.join("/") : parts;
}

export async function generateMetadata(props) {
  const page = await getCachedPage(slugOf(await props.params));
  if (!page) return {};

  const ogImage = ogImageUrl(page.title);

  return {
    title: page.title + " - " + siteMetadata.publishName,
    description: page.description,
    openGraph: {
      title: page.title + " - " + siteMetadata.publishName,
      description: page.description,
      url: "/" + page.slugAsParams,
      siteName: siteMetadata.siteName,
      images: [{ url: ogImage }],
      locale: siteMetadata.language,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: page.title + " - " + siteMetadata.publishName,
      description: page.description,
      images: [ogImage],
    },
  };
}

export function generateStaticParams() {
  return getPages().map((page) => ({
    slug: page.slugAsParams.split("/"),
  }));
}

/**
 * The page shell is URL-independent, so it prerenders; the params read lives in
 * a <Suspense> child. Anything that awaited `params` up here would leave the
 * route with no static shell and fail the build (blocking-prerender-dynamic).
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

export default function PagePage({ params }) {
  return (
    <>
      <RouteTransition>
        <div className="relative gap-10 xl:grid xl:grid-cols-[minmax(0,1fr)_16rem]">
          <PageTransition className="min-w-0">
            <Suspense fallback={<PageSkeleton />}>
              <PageBody params={params} />
            </Suspense>
          </PageTransition>
          <aside className="hidden xl:block">
            <div className="sticky-below-nav toc-panel pt-12">
              <h2 className="section-label">目录</h2>
              <div className="mt-3">
                <Suspense fallback={<div className="h-24" aria-hidden="true" />}>
                  <PageToc params={params} />
                </Suspense>
              </div>
            </div>
          </aside>
        </div>
      </RouteTransition>
      <ScrollTopAndComment />
    </>
  );
}

async function PageBody({ params }) {
  const page = await getCachedPage(slugOf(await params));
  if (!page) notFound();

  return (
    <article className="prose mx-auto max-w-none py-8 sm:max-w-3xl">
      <h1 className="text-h1 font-semibold leading-tight tracking-tight text-foreground">
        {page.title}
      </h1>
      {page.description && (
        <p className="mt-2 text-lead text-muted">
          {page.description}
        </p>
      )}
      {/* Optional page avatar, rendered from frontmatter rather than the body.
          A page's markdown is pure -- the pipeline runs remarkRehype and
          rehypeStringify bare, so raw HTML is discarded, not escaped -- which is
          why the avatar cannot be an <img> tag in about.md. The `avatar:` key is
          opt-in, so pages without one are unchanged. `not-prose` keeps the
          article's prose rules off it. */}
      {page.avatar ? (
        <div className="not-prose flex justify-center pb-4 pt-2">
          <Image
            src={page.avatar}
            alt="Avatar"
            width={100}
            height={100}
            className="rounded-full ring-2 ring-border transition-transform duration-(--duration-base) ease-out-expo hover:scale-105"
          />
        </div>
      ) : null}
      <OptimizedHTMLRenderer htmlContent={page.html} />
      {/* Opt-in via `portfolio: true` in the page frontmatter — the starter
          template ships this page without the flag. */}
      {page.portfolio ? <Portfolio /> : null}
      <hr />
      <Suspense fallback={<div className="h-32" aria-hidden="true" />}>
        <Comments />
      </Suspense>
    </article>
  );
}

async function PageToc({ params }) {
  const page = await getCachedPage(slugOf(await params));
  if (!page) return null;
  return <TableofContent headings={page.headings} />;
}
