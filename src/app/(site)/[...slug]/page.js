import { notFound, permanentRedirect, redirect } from "next/navigation";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import siteMetadata from "../../../../data/sitemetadata.js";
import TableofContent from "../../../components/toc.js";
import ScrollTopAndComment from "../../../components/scroll.js";
import PageTransition from "../../../components/page-transition.js";
import MDXRenderer from "../../../components/mdx-renderer.js";
import { getPageBySlug, getPageSlugs } from "../../../lib/content/pages.js";
import { follow, recordHit } from "../../../lib/studio/redirects.js";

const Comments = dynamic(() => import("../../../components/comments.js"), {
  loading: () => <div className="h-32" aria-hidden />,
});

/**
 * A retired path, or null.
 *
 * This route is the catch-all: once a page is renamed, its old slug matches no
 * route and lands here. That makes this the one place in the site that can turn
 * "no such page" into "that page moved", which is why the redirect lookup lives
 * here rather than in the proxy — a proxy runs on the edge runtime, where there
 * is no database to reach.
 *
 * `src/app/(site)/blog/[...slug]/page.js` carries the same function for posts,
 * and the two are deliberately separate rather than shared: each builds a
 * different path and each was written at a different time. The duplication is
 * the reason one of them was missed for a while; the note there records what
 * went wrong.
 *
 * Returns null when there is no redirect, and also when a chain does not
 * terminate (a cycle). A reader who hits a redirect loop cannot get out of it
 * by clicking Back, so a loop is answered with a 404 instead.
 *
 * ## The duplicated `location` header
 *
 * On a cache MISS this response carries `location` twice — once from the
 * prerender, where the lookup returned null, and once from the request-time
 * render. Measured on `next start` with a raw socket; the values are identical
 * so every client resolves it the same way, and `fetch` with `redirect:
 * "manual"` (which is what a test should use) sees it as a single value.
 *
 * It is recorded rather than fixed. The fix in the framework's own vocabulary
 * is `await connection()`, which declares that the response's headers depend on
 * request-time data — but inside a partially prerendered page with no Suspense
 * boundary it fails the blocking-prerender check and turns every unknown path
 * into a 500. `instant = false` would also fix the header and break the 404,
 * because a blocking route commits its status line before the render that
 * discovers there is no page.
 */
async function movedTo(slug) {
  const target = await follow(`/${slug}`);
  if (!target) return null;
  recordHit(`/${slug}`);
  return target;
}

export async function generateMetadata(props) {
  const params = await props.params;
  const page = await getPageBySlug(params?.slug?.join("/"));

  if (!page) {
    return {};
  }

  return {
    title: page.title + " - " + siteMetadata.publishName,
    description: page.description,
    openGraph: {
      title: page.title + " - " + siteMetadata.publishName,
      description: page.description,
      url: "/" + page.slugAsParams,
      siteName: siteMetadata.siteName,
      images: [
        {
          url: `/og?title=${page.title}`,
        },
      ],
      locale: siteMetadata.language,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: page.title + " - " + siteMetadata.publishName,
      description: page.description,
      images: `/og?title=${page.title}`,
    },
  };
}

export async function generateStaticParams() {
  const slugs = await getPageSlugs();
  return slugs.map((slug) => ({
    slug: slug.split("/"),
  }));
}

export default async function PagePage(props) {
  const params = await props.params;
  const slug = params?.slug?.join("/");
  const page = await getPageBySlug(slug);

  // A path that no longer exists may have been renamed rather than removed.
  // Checked BEFORE notFound(), and only on the miss path, so the common case —
  // a live page — never touches the redirect table.
  //
  // `permanentRedirect` rather than `redirect` when the row says so: the two
  // emit different status codes (308 against 307) and only the 308 tells a
  // search engine to move its index entry. A rename is permanent by intent —
  // the destination is where the page now lives — so anything else would leave
  // crawlers pointing at a retired URL forever.
  if (!page) {
    const moved = await movedTo(slug);
    if (moved) {
      if (moved.permanent) permanentRedirect(moved.destination);
      redirect(moved.destination);
    }
    notFound();
  }

  if (page.draft === true) {
    notFound();
  }
  // Page-level comment switch, on by default. Rendered as a fragment rather
  // than wrapping the whole article so the divider keeps its previous
  // placement relative to the closing prose block.
  const showComments = page.giscusEnabled !== false;

  return (
    <>
      <div className="relative mx-auto max-w-5xl gap-8 xl:grid xl:grid-cols-8">
        <PageTransition className="col-span-6">
          <article className="prose dark:prose-invert mx-auto max-w-2xl py-8">
            <h1 className="mb-2 py-4 text-3xl font-semibold leading-tight tracking-tight text-foreground">
              {page.title}
            </h1>
            {page.description && (
              <p className="mt-2 font-serif text-base leading-7 text-foreground/70">
                {page.description}
              </p>
            )}
            <MDXRenderer code={page.mdxCode} />
            {showComments && (
              <>
                <hr />
                <Suspense fallback={<div className="h-32" aria-hidden />}>
                  <Comments />
                </Suspense>
              </>
            )}
          </article>
        </PageTransition>
        <div
          className="col-span-2 mx-auto sticky hidden pt-12 xl:block"
          style={{ top: "calc(var(--nav-height) + 0.5rem)" }}
        >
          <p className="py-4 text-sm font-medium text-muted">目录</p>
          <TableofContent headings={page.headings} />
        </div>
      </div>
      <ScrollTopAndComment />
    </>
  );
}
