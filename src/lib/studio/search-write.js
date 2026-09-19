/**
 * Writing the unified search index.
 *
 * `search_index` is one row per searchable unit — a post, a page, a collection
 * entry — and it is maintained by the APPLICATION, not by triggers. That is not
 * a shortcut: the row is composed from several tables (title and description
 * from a revision, tags from `post_tags`, body text from rendered HTML), and a
 * trigger cannot run the markdown renderer. Migration 0001 says the same thing;
 * this is the code it was describing.
 *
 * The consequence worth naming: a write path that forgets to call this leaves a
 * stale search row, and nothing will ever fix it on its own. So every writer
 * calls it, and the tag names it is cached under are in ./cache-tags.js rather
 * than typed inline.
 *
 * ## `tags` is written twice, on purpose
 *
 * `tags` is a text[] used for filtering, and `tags_text` feeds the generated
 * `search_doc` column. A GENERATED column cannot reference another table (see
 * 0002), so the label text has to be a plain column written here. Both carry
 * the Chinese display label as well as the English slug, because a reader
 * searching 经济学 should find the posts tagged Economics — and the previous
 * Fuse implementation did match that, so dropping it would be a regression
 * dressed up as a cleanup.
 */

import { query } from "../db";

/**
 * The body text a search should match against.
 *
 * Rendered HTML with the markup stripped. Deliberately the same reduction the
 * importer uses (`stripHtml` in scripts/db/import-posts.mjs) so a re-import and
 * a publish produce the same index for the same content.
 *
 * KaTeX output is removed before stripping: `output: "htmlAndMathml"` emits
 * every formula twice, once as visual HTML and once as a MathML tree with the
 * same characters in it, so a post about economics would match 边际 twice and
 * — worse — a search for a subscript name would match a string that never
 * appears in the rendered page.
 */
export function searchableText(html) {
  return String(html ?? "")
    .replace(/<span class="katex-html"[\s\S]*?<\/span><\/span>/g, " ")
    .replace(/<annotation[\s\S]*?<\/annotation>/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<pre class="mermaid"[\s\S]*?<\/pre>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Upsert the index row for a post.
 *
 * Called from publish, from unpublish (which downgrades the row), and from
 * delete (which removes it) via the functions at the bottom.
 */
export async function indexPost({
  postId,
  slug,
  title,
  description,
  html,
  tags,
  labels,
  publishedAt,
}) {
  const labelText = (labels ?? []).map(String);
  const allTags = [...new Set([...(tags ?? []).map(String), ...labelText])];

  await query(
    `INSERT INTO search_index
       (id, kind, ref_id, title, description, url, tags, tags_text, body_text, published_at)
     VALUES ($1,'post',$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET
       title        = EXCLUDED.title,
       description  = EXCLUDED.description,
       url          = EXCLUDED.url,
       tags         = EXCLUDED.tags,
       tags_text    = EXCLUDED.tags_text,
       body_text    = EXCLUDED.body_text,
       published_at = EXCLUDED.published_at,
       updated_at   = now()`,
    [
      `post:${slug}`,
      postId,
      title,
      description ?? null,
      `/blog/${slug}`,
      allTags,
      labelText.join(" "),
      searchableText(html),
      publishedAt ?? null,
    ]
  );
}

/** Remove a post from the index, on delete or on unpublish. */
export async function unindex(id) {
  await query(`DELETE FROM search_index WHERE id = $1`, [id]);
}

export async function indexPage({ pageId, slug, title, description, html, publishedAt }) {
  await query(
    `INSERT INTO search_index
       (id, kind, ref_id, title, description, url, tags, tags_text, body_text, published_at)
     VALUES ($1,'page',$2,$3,$4,$5,'{}','',$6,$7)
     ON CONFLICT (id) DO UPDATE SET
       title        = EXCLUDED.title,
       description  = EXCLUDED.description,
       url          = EXCLUDED.url,
       body_text    = EXCLUDED.body_text,
       published_at = EXCLUDED.published_at,
       updated_at   = now()`,
    [
      `page:${slug}`,
      pageId,
      title,
      description ?? null,
      `/${slug}`,
      searchableText(html),
      publishedAt ?? null,
    ]
  );
}

/**
 * Index a collection entry that is meant to be searchable.
 *
 * Off by default: collections are structured data whose public pages are
 * hand-written, so a portfolio item has no address of its own to send a
 * searcher to. `public_read` on the collection is the opt-in, and even then the
 * URL is the collection's own page — which is what a person who searched for it
 * actually wants.
 */
export async function indexCollectionEntry({
  collectionSlug,
  entryId,
  title,
  description,
  text,
  tags,
  publishedAt,
  url,
}) {
  await query(
    `INSERT INTO search_index
       (id, kind, ref_id, title, description, url, tags, tags_text, body_text, published_at)
     VALUES ($1,'collection_entry',$2,$3,$4,$5,$6,'',$7,$8)
     ON CONFLICT (id) DO UPDATE SET
       title        = EXCLUDED.title,
       description  = EXCLUDED.description,
       url          = EXCLUDED.url,
       tags         = EXCLUDED.tags,
       body_text    = EXCLUDED.body_text,
       published_at = EXCLUDED.published_at,
       updated_at   = now()`,
    [
      `entry:${collectionSlug}:${entryId}`,
      entryId,
      title,
      description ?? null,
      url ?? `/${collectionSlug}`,
      (tags ?? []).map(String),
      text ?? null,
      publishedAt ?? null,
    ]
  );
}
