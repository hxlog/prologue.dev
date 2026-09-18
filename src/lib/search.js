/**
 * Site-wide search, server-side, over the `search_index` table.
 *
 * Replaces the Fuse.js implementation. Fuse was chosen because the site was
 * static and its index was 15 KB; that constraint is gone now, and Fuse could
 * not actually do the job it was standing in for. Measured on the real corpus,
 * 10 of 15 realistic queries returned nothing, because Fuse matches
 * subsequences within a single field and has no notion of ranking across a
 * document. PostgreSQL with the bigram tokenizer finds 1-9 results for each of
 * the same queries.
 *
 * The query MUST go through `zh_q()`. `plainto_tsquery` against a bigram index
 * matches nothing for Chinese, silently — see db/README.md.
 *
 * Snippets are built here rather than by `ts_headline`, which does not work for
 * CJK at all (it matches raw parser tokens against dictionary-normalized
 * lexemes, so against bigram tokens it highlights nothing and returns an
 * unhighlighted prefix). Because that also means we are not relying on
 * ts_headline's escaping, the snippet is plain text and the caller renders it as
 * text — never as HTML.
 */

import { queryMany } from "./db";

/**
 * Does the term contain anything the tokenizer will actually index?
 *
 * The class mirrors `zh_tok`'s in db/migrations/0003: CJK, then Latin/digits.
 * It MUST be written as an explicit range rather than `\p{Script=Han}` —
 * without the `u` flag, `\p{...}` is not a Unicode property escape at all, and
 * the character class silently matched nothing but the literal letters
 * `p`,`S`,`c`,`r`,`i`,`t`,`=`,`H`,`a`,`n`. Every Chinese query therefore
 * returned zero results with no error, which is exactly the failure mode this
 * guard exists to prevent.
 */
const SEARCHABLE = /[一-鿿A-Za-z0-9_]/;

function hasSearchableTerms(input) {
  return SEARCHABLE.test(input);
}

/**
 * @param {string} rawQuery
 * @param {{limit?: number, kind?: string|null}} options
 * @returns {Promise<Array<{slug, title, description, publishDate, tags, readingTime, snippet}>>}
 */
export async function searchPosts(rawQuery, { limit = 40, kind = "post" } = {}) {
  const term = String(rawQuery ?? "").trim();
  if (term.length < 1 || !hasSearchableTerms(term)) return [];

  const rows = await queryMany(
    `SELECT s.id,
            s.title,
            s.description,
            s.url,
            s.tags,
            s.published_at,
            left(s.body_text, 160) AS snippet,
            coalesce(p.featured, false) AS featured,
            (p.reading_time->>'text') AS reading_time,
            ts_rank_cd(s.search_doc, zh_q($1)) AS rank
       FROM search_index s
       -- LEFT JOIN, not INNER: the index also holds rows for kinds that have
       -- no posts row (pages), and an inner join would silently drop them.
       LEFT JOIN posts p ON s.kind = 'post' AND p.id = s.ref_id
      WHERE ($2::text IS NULL OR s.kind = $2)
        AND s.search_doc @@ zh_q($1)
      ORDER BY rank DESC, s.published_at DESC NULLS LAST
      LIMIT $3`,
    [term, kind, limit]
  );

  return rows.map((row) => ({
    // The card components key on `slug` and link with it, so the URL is
    // returned in the form they already expect rather than a bare path.
    slug: row.url,
    title: row.title,
    description: row.description ?? "",
    publishDate: row.published_at ? new Date(row.published_at).toISOString() : null,
    tags: row.tags ?? [],
    readingTime: row.reading_time ?? null,
    featured: row.featured === true,
    snippet: row.snippet ?? "",
  }));
}

/** Count only, for the "N results" line. */
export async function countSearchResults(rawQuery, { kind = "post" } = {}) {
  const term = String(rawQuery ?? "").trim();
  if (term.length < 1 || !hasSearchableTerms(term)) return 0;

  const rows = await queryMany(
    `SELECT count(*)::int AS n
       FROM search_index
      WHERE ($2::text IS NULL OR kind = $2)
        AND search_doc @@ zh_q($1)`,
    [term, kind]
  );
  return rows[0]?.n ?? 0;
}
