-- =============================================================================
-- 0010: navigation becomes data
--
-- `nav_items` has existed since 0001 but nothing has ever read it: the public
-- navbar still imports `data/headerNavLinks.js`. So the table held a seed with
-- English labels ("Blog", "Microblog", "Tags", "Links", "About") that did not
-- match what the site renders ("归档", "微博", "友链", "关于作者") — it also had a
-- Tags entry the header has never shown.
--
-- This migration is therefore two things:
--
--   1. It corrects the rows to exactly what the static file says, in exactly
--      that order. That is a precondition, not a nicety: the next commit points
--      the navbar at this table, and if the rows do not match the file the
--      switch would silently relabel and reorder the site's own navigation.
--
--   2. It adds the two columns the studio needs. `pages.show_in_nav` is a
--      per-page toggle, and a page that is in the navigation needs a row here;
--      `page_slug` is what ties the two together, so deleting a page can find
--      and remove its nav entry without guessing at string equality on a label
--      the author may have edited.
--
-- ## Why the labels are not quoted in the source file
--
-- They were, in a sense: `data/headerNavLinks.js` is the record of what the
-- site renders today, and this migration copies it. The file is deleted in the
-- same commit that starts reading this table, so there is exactly one moment at
-- which both exist and they agree — which is the only condition under which
-- switching a data source is safe.
-- =============================================================================


-- The rows as the header renders them. Replaced wholesale rather than upserted:
-- the point is that the table equals the file, and an upsert would leave the
-- stale Tags entry behind.
DELETE FROM nav_items;

INSERT INTO nav_items (label, href, sort_order, visible, external) VALUES
  ('关于作者', '/about',     0, true, false),
  ('微博',     '/microblog', 1, true, false),
  ('友链',     '/links',     2, true, false),
  ('归档',     '/blog',      3, true, false);


-- Which page, if any, owns this row. NULL for a hand-made entry like /blog,
-- which is a route rather than a page.
--
-- ON DELETE SET NULL rather than CASCADE: removing a page should not silently
-- remove a nav entry the author may have pointed somewhere else in the meantime.
-- `deletePage` removes the row explicitly and deliberately; this column is the
-- pointer the studio uses to find it, not a lifecycle.
ALTER TABLE nav_items
  ADD COLUMN page_slug text REFERENCES pages(slug) ON DELETE SET NULL;

CREATE UNIQUE INDEX nav_items_page_slug_idx
  ON nav_items (page_slug) WHERE page_slug IS NOT NULL;

-- `sort_order` ties are possible (two entries inserted in the same second) and
-- the order they render in must be stable, or a nav reorders itself between
-- requests. `created_at` then `href` make the ordering total.
CREATE INDEX nav_items_stable_order_idx ON nav_items (sort_order, created_at, href);
