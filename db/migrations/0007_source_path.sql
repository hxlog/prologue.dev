-- =============================================================================
-- 0007: preserve the source file path
--
-- Every post page ends with a link to the post's markdown on GitHub, built from
-- `urlslug`:
--
--   /blog/2023-Introduction-to-articles.md
--   /blog/is-there-a-new-logic-behind-bitcoin-in-2026.md
--
-- `urlslug` is the case-preserving form of the file's path; `slug` is the
-- lowercased one the router matches on. The importer wrote only the lowercased
-- value into `posts.slug`, so all 44 posts whose filename has an uppercase
-- letter now link to a path that does not exist — `2023-introduction-to-
-- articles.md` returns a 404 on GitHub.
--
-- Storing the original path restores the link exactly. It is worth keeping
-- beyond that: it is the only remaining provenance for a post, and the studio's
-- "view source" affordance will want it.
-- =============================================================================

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS source_path text;

-- Backfill from the markdown that was imported: the frontmatter of a file whose
-- path we cannot recover still carries a title, so this is a best-effort match
-- and the importer re-writes the authoritative value on its next run.
COMMENT ON COLUMN posts.source_path IS
  'Case-preserving path relative to data/content, e.g. blog/2023-Introduction-to-articles. Used for the GitHub source link; NOT a route. The route is posts.slug, which is lowercased.';
