-- =============================================================================
-- 0006: stable entry anchors, and an explicit ordering mode per collection
--
-- 1. ANCHORS
--
-- Microblog entries are addressable: the card carries `id={entry.id}`, the
-- page links `#<id>`, and the RSS feed uses the same value as the item guid.
-- That id was `mb-<yyyymmdd>-<n>` where n was the entry's index in the YAML
-- file — a position, not an identity. Inserting one entry at the top of the
-- file renumbered every entry after it, so every subscriber's reader saw the
-- whole microblog as new.
--
-- That flaw is being carried across rather than introduced, and it is worth
-- removing now: the entries are about to be written by /studio, where
-- insertion in the middle is a normal thing to do. An explicit anchor column
-- makes the id an identity. Existing anchors are assigned to match the ids the
-- live site serves today, so nothing re-numbers and no reader re-notifies.
--
-- 2. ORDERING
--
-- A microblog is chronological and a portfolio is curated, and those want
-- opposite ORDER BY clauses. Expressing it as a per-collection setting keeps
-- one query honest instead of guessing from the data, which would silently
-- change when someone set a date on a portfolio entry.
-- =============================================================================

-- The anchor is unique within its collection, not globally: two collections
-- may both legitimately have an entry called 'intro'.
ALTER TABLE collection_entries
  ADD COLUMN IF NOT EXISTS anchor text;

-- A plain unique index, deliberately not a partial one. `ON CONFLICT
-- (collection_id, anchor)` can only infer a PARTIAL index if the statement
-- repeats the predicate, so every future insert that forgets `WHERE anchor IS
-- NOT NULL` fails with "no unique or exclusion constraint matching the ON
-- CONFLICT specification" — an error that reads like a schema problem and is
-- actually a call-site omission. PostgreSQL already treats NULLs as distinct
-- in a unique index, so rows without an anchor are unaffected and the plain
-- form is strictly easier to use correctly.
CREATE UNIQUE INDEX IF NOT EXISTS collection_entries_anchor_idx
  ON collection_entries (collection_id, anchor);

-- Ordering mode. 'date' -> chronological, ties broken by sort_order so the
-- original file order survives within a single day. 'manual' -> curated, ties
-- broken by recency so a new entry does not disappear to the bottom.
ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS ordering text NOT NULL DEFAULT 'manual';

ALTER TABLE collections
  DROP CONSTRAINT IF EXISTS collections_ordering_check;
ALTER TABLE collections
  ADD CONSTRAINT collections_ordering_check
  CHECK (ordering IN ('date', 'manual'));

-- The two orderings need different index column orders to be usable.
CREATE INDEX IF NOT EXISTS collection_entries_date_idx
  ON collection_entries (collection_id, published_at DESC NULLS LAST, sort_order);

CREATE INDEX IF NOT EXISTS collection_entries_manual_idx
  ON collection_entries (collection_id, sort_pinned DESC, sort_order, published_at DESC NULLS LAST);

-- The generic index from 0005 is now redundant: every read goes through one of
-- the two above, selected by the collection's ordering mode.
DROP INDEX IF EXISTS collection_entries_order_idx;
