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

/** One page, with its raw MDX source and compiled bytecode. */
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
  if (!row) return null;

  return {
    ...toPage(row, { includeBody: true }),
    // For a Page, the stored `html` column holds compiled MDX bytecode rather
    // than markup — the renderable artifact for an MDX document is a component.
    // The naming is unfortunate; see scripts/db/import-pages.mjs.
    mdxCode: row.html,
  };
}

/**
 * Every published page's slug, for `generateStaticParams`.
 *
 * Drafts are excluded: a draft page must 404, and prerendering it would write a
 * real route for it.
 */
export async function getPageSlugs() {
  const rows = await queryMany(
    `SELECT slug FROM pages WHERE status = 'published' ORDER BY slug`
  );
  return rows.map((r) => r.slug);
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
