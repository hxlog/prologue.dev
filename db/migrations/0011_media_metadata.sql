-- =============================================================================
-- Media: the fields the library screen needs that 0001 did not anticipate.
--
-- 0001 declared `media` when the shape of the library was still a guess — it
-- carries `blur_data_url` and `width`/`height`, which nothing ended up needing,
-- and is missing the two things the screen actually shows: the name the file
-- arrived with, and the order it was added in when two uploads land in the same
-- millisecond.
--
-- `original_name` is kept for DISPLAY ONLY. The pathname is generated from a
-- slugified, truncated form of it plus a random prefix, so the two are not
-- derivable from each other — and that is the point. `Screenshot 2026-09-19 at
-- 11.24.31.png` is what an author searches for; `media/2026/09/9f3c1a2b-screenshot.png`
-- is what the store and the URL hold.
-- =============================================================================

ALTER TABLE media ADD COLUMN IF NOT EXISTS original_name text;

-- Uploads arrive in batches (a microblog entry with four photos), so
-- `created_at` alone is not a total order. The tiebreaker is the uuid, which is
-- arbitrary but STABLE — a grid that reshuffles between two renders of the same
-- data looks like a bug and is impossible to explain.
CREATE INDEX IF NOT EXISTS media_created_stable_idx
  ON media (created_at DESC, id DESC);

-- Searching the library by filename or alt text.
--
-- This query is `ILIKE '%…%'` and NOT the bigram tokenizer `search_index` uses,
-- which is a deliberate difference and not an oversight. `zh_tok` exists because
-- a post body is long enough that a sequential scan of 63 of them is worth
-- avoiding; a library of a few hundred filenames is not, and `ILIKE` matches a
-- substring of ANY script — Chinese, English, `IMG_4021`, and the mixed case in
-- between — with no tokenizer to keep in step. If the library ever grows past a
-- few thousand objects the right move is to extend `search_index` rather than to
-- invent a second tokenizer here.
CREATE INDEX IF NOT EXISTS media_search_idx
  ON media USING gin ((coalesce(original_name, '') || ' ' || coalesce(alt, '') || ' ' || coalesce(caption, '')) gin_trgm_ops);
