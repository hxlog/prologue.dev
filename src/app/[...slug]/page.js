import { notFound } from "next/navigation";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import siteMetadata from "../../../data/sitemetadata";
import TableofContent from "../../components/toc";
import ScrollTopAndComment from "../../components/scroll";
import PageTransition from "../../components/page-transition";
import MDXRenderer from "../../components/mdx-renderer";
import { getPageBySlug, getPageSlugs } from "../../lib/content/pages";

const Comments = dynamic(() => import("../../components/comments"), {
  loading: () => <div className="h-32" aria-hidden />,
});

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
  const page = await getPageBySlug(params?.slug?.join("/"));

  if (!page || page.draft === true) {
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
