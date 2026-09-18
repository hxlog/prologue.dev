-- =============================================================================
-- 0004: fix reading-time input, and store tag order
--
-- Two defects found by scripts/db/verify-content-parity.mjs, which compares
-- every field the public site reads against the Contentlayer output it
-- replaces. Both would have changed visible output.
--
-- 1. readingTime. Contentlayer computed it from `doc.body.raw`, which had
--    frontmatter stripped. The import computed it from the whole file, so
--    every post reported a higher word count (2023-introduction-to-articles:
--    1226 vs 1192). The word count and reading time are rendered on every
--    post page, so this is user-visible. Fixed in
--    src/lib/markdown/render.js, not here.
--
-- 2. Tag order. post_tags is a (post_id, tag_id) join table with no ordering
--    column, and PostgreSQL returns rows in whatever order it likes. The
--    tag-chip row renders only the first 2-3 tags and hides the rest behind
--    "+N", so order is directly visible. The frontmatter order
--    (2023-introduction-to-articles: ["Meta", "Education", "Politics"]) must
--    be preserved exactly.
-- =============================================================================

ALTER TABLE post_tags
  ADD COLUMN IF NOT EXISTS position int NOT NULL DEFAULT 0;

-- Backfill from the current physical row order, which for freshly-imported
-- rows is insertion order (verified with ctid before writing this). This is
-- only a safety net so the column is never ambiguous; the import script
-- re-writes `position` from the frontmatter array on every run.
WITH ordered AS (
  SELECT ctid,
         row_number() OVER (PARTITION BY post_id ORDER BY ctid) - 1 AS pos
    FROM post_tags
)
UPDATE post_tags pt
   SET position = o.pos
  FROM ordered o
 WHERE pt.ctid = o.ctid;

-- The list query always orders by position; include post_id so this is a
-- covering index for "give me this post's tags in order".
CREATE INDEX IF NOT EXISTS post_tags_post_position_idx
  ON post_tags (post_id, position);
