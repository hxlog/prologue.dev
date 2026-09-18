/**
 * Page reads (MDX pages: /about and anything else under data/content/pages).
 *
 * Pages are stored the same way as posts — a `pages` row plus immutable
 * `page_revisions` — but rendered differently. A Post is `contentType:
 * "markdown"`: one HTML string. A Page is `contentType: "mdx"`: a compiled JS
 * module evaluated by `useMDXComponent` in the browser, because the source
 * contains JSX (`<img ... />`, `<center>`) that markdown alone cannot express.
 *
 * That means a page's stored artifact cannot be a flat HTML string the way a
 * post's is. It has to be the MDX source, compiled at render time.
 */

import { queryOne, queryMany } from "../db";
import { parseContentDate } from "./dates";
import { renderMarkdown } from "../markdown/render";

function toPage(row, { includeBody = false } = {}) {
  const page = {
    slugAsParams: row.slug,
    slug: `/${row.slug}`,
    urlslug: `/pages/${row.slug}`,
    title: row.title,
    description: row.description ?? "",
    headings: row.headings ?? [],
    draft: row.status !== "published",
    giscusEnabled: row.giscus_enabled !== false,
    customCss: row.custom_css ?? null,
    _raw: { flattenedPath: `pages/${row.slug}` },
  };

  if (includeBody) {
    page.body = { raw: row.markdown ?? "" };
  }

  return page;
}

/** Every page a reader could navigate to. */
export async function getAllPages() {
  const rows = await queryMany(
    `SELECT p.id, p.slug, p.status, p.giscus_enabled, p.custom_css,
            p.title, p.description, p.headings
       FROM pages p
      WHERE p.status <> 'archived'`
  );
  return rows.map((r) => toPage(r));
}

/** One page, with its raw MDX source for the renderer. */
export async function getPageBySlug(slug) {
  const row = await queryOne(
    `SELECT p.id, p.slug, p.status, p.giscus_enabled, p.custom_css,
            p.title, p.description, p.headings,
            r.markdown, r.html
       FROM pages p
       LEFT JOIN page_revisions r
         ON r.id = coalesce(p.published_revision_id, p.draft_revision_id)
      WHERE p.slug = $1`,
    [String(slug).toLowerCase()]
  );
  return row ? { ...toPage(row, { includeBody: true }), html: row.html } : null;
}

/**
 * Read a page body as HTML.
 *
 * The routes render MDX through `useMDXComponent`, which needs the compiled
 * bytecode Contentlayer produced. Reproducing that outside Contentlayer means
 * running `@mdx-js/mdx`'s `compile` with the same plugin set, which is a
 * dependency the site does not currently carry.
 *
 * This function exists so that choice is explicit and localised rather than
 * spread through the route: it renders the MDX source through the same unified
 * pipeline posts use, which handles every construct in the current /about
 * source (headings, lists, links, inline HTML) except JSX component syntax.
 * The route keeps using `useMDXComponent` until the Contentlayer removal, at
 * which point this becomes the page renderer and any page that genuinely needs
 * JSX gets an explicit escape hatch.
 */
export async function renderPageBody(markdown) {
  return renderMarkdown(markdown);
}

/** Page metadata for the sitemap and nav. */
export async function getPagesForSitemap() {
  const rows = await queryMany(
    `SELECT slug, published_at, updated_at
       FROM pages
      WHERE status = 'published'`
  );
  return rows.map((r) => ({
    slug: r.slug,
    lastModified: parseContentDate(r.published_at ?? r.updated_at),
  }));
}
