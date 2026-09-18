-- =============================================================================
-- 0005: denormalised list columns + the collections read path
--
-- Everything below exists because the public site reads posts in BULK — the
-- home page, /blog, /tags/<slug>, the sitemap and the three feed routes all
-- want every published post with its title, description, tags and reading
-- time. Serving that from post_revisions would mean a join, a jsonb cast and
-- a per-row tag subquery for the most frequently rendered pages on the site.
--
-- The columns added to `posts` project whichever revision the post currently
-- points at (published if it has one, else the draft). Draining the draft
-- rather than the published revision is deliberate: /studio lists drafts too,
-- and the reader path filters `status = 'published'` and reads the same
-- columns. One projection, two consumers, no join on either.
-- =============================================================================


-- =============================================================================
-- 1. posts: list projection
-- =============================================================================

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS title          text,
  ADD COLUMN IF NOT EXISTS description    text,
  ADD COLUMN IF NOT EXISTS headings       jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reading_time   jsonb,
  ADD COLUMN IF NOT EXISTS content_hash   text;

-- Seed from whatever revision each post currently points at.
UPDATE posts p
   SET title        = r.title,
       description  = r.description,
       headings     = r.headings,
       reading_time = r.reading_time,
       content_hash = r.content_hash
  FROM post_revisions r
 WHERE r.id = coalesce(p.published_revision_id, p.draft_revision_id);

-- The column stays nullable: a post exists before its first revision does,
-- and the query layer treats a NULL title as "untitled draft".

-- =============================================================================
-- Projection maintenance.
--
-- Two triggers, because the projection can go stale in two different ways and
-- neither fires the other's event:
--
--   a. The post's POINTER moves (publish, revert, "switch to draft", discard
--      draft). This is an UPDATE on `posts`.
--   b. The revision the post ALREADY points at is edited in place. This is an
--      UPDATE on `post_revisions`.
--
-- A trigger on post_revisions alone is not enough, and this was measured: on
-- INSERT the row is new, so the `coalesce(published, draft) = r.id` guard is
-- false at the moment the trigger runs — the caller has not moved the pointer
-- yet. The insert fires, matches nothing, and the projection silently keeps
-- the previous revision's title. That is exactly the bug worth a comment.
--
-- Trigger recursion is avoided by column: the refresh UPDATE sets title /
-- description / headings / reading_time / content_hash, and the `posts`
-- trigger is declared `UPDATE OF draft_revision_id, published_revision_id`.
-- PostgreSQL fires a column-scoped trigger only when one of those columns is
-- named in the SET list, so the refresh cannot re-enter itself.
-- =============================================================================

CREATE OR REPLACE FUNCTION refresh_post_projection(target_post_id uuid)
RETURNS void AS $$
  UPDATE posts p
     SET title        = r.title,
         description  = r.description,
         headings     = r.headings,
         reading_time = r.reading_time,
         content_hash = r.content_hash
    FROM post_revisions r
   WHERE p.id = target_post_id
     AND r.id = coalesce(p.published_revision_id, p.draft_revision_id);
$$ LANGUAGE sql;

-- (a) pointer moved
CREATE OR REPLACE FUNCTION posts_projection_on_pointer() RETURNS trigger AS $$
BEGIN
  PERFORM refresh_post_projection(NEW.id);
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS posts_projection_sync ON posts;
CREATE TRIGGER posts_projection_sync
  AFTER INSERT OR UPDATE OF draft_revision_id, published_revision_id
  ON posts
  FOR EACH ROW EXECUTE FUNCTION posts_projection_on_pointer();

-- (b) the pointed-at revision was edited
CREATE OR REPLACE FUNCTION post_revisions_projection_on_edit() RETURNS trigger AS $$
BEGIN
  UPDATE posts p
     SET title        = NEW.title,
         description  = NEW.description,
         headings     = NEW.headings,
         reading_time = NEW.reading_time,
         content_hash = NEW.content_hash
   WHERE p.id = NEW.post_id
     AND coalesce(p.published_revision_id, p.draft_revision_id) = NEW.id;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS post_revisions_projection_sync ON post_revisions;
CREATE TRIGGER post_revisions_projection_sync
  AFTER UPDATE OF title, description, headings, reading_time, content_hash
  ON post_revisions
  FOR EACH ROW EXECUTE FUNCTION post_revisions_projection_on_edit();

-- Reader path: published posts, newest first.
CREATE INDEX IF NOT EXISTS posts_published_list_idx
  ON posts (published_at DESC NULLS LAST)
  WHERE status = 'published';


-- =============================================================================
-- 2. pages: list projection (same reasoning, smaller surface)
-- =============================================================================

ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS title        text,
  ADD COLUMN IF NOT EXISTS description  text,
  ADD COLUMN IF NOT EXISTS headings     jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE pages p
   SET title       = r.title,
       description = r.description,
       headings    = r.headings
  FROM page_revisions r
 WHERE r.id = coalesce(p.published_revision_id, p.draft_revision_id);

CREATE OR REPLACE FUNCTION refresh_page_projection(target_page_id uuid)
RETURNS void AS $$
  UPDATE pages p
     SET title       = r.title,
         description = r.description,
         headings    = r.headings
    FROM page_revisions r
   WHERE p.id = target_page_id
     AND r.id = coalesce(p.published_revision_id, p.draft_revision_id);
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION pages_projection_on_pointer() RETURNS trigger AS $$
BEGIN
  PERFORM refresh_page_projection(NEW.id);
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pages_projection_sync ON pages;
CREATE TRIGGER pages_projection_sync
  AFTER INSERT OR UPDATE OF draft_revision_id, published_revision_id
  ON pages
  FOR EACH ROW EXECUTE FUNCTION pages_projection_on_pointer();

CREATE OR REPLACE FUNCTION page_revisions_projection_on_edit() RETURNS trigger AS $$
BEGIN
  UPDATE pages p
     SET title       = NEW.title,
         description = NEW.description,
         headings    = NEW.headings
   WHERE p.id = NEW.page_id
     AND coalesce(p.published_revision_id, p.draft_revision_id) = NEW.id;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS page_revisions_projection_sync ON page_revisions;
CREATE TRIGGER page_revisions_projection_sync
  AFTER UPDATE OF title, description, headings
  ON page_revisions
  FOR EACH ROW EXECUTE FUNCTION page_revisions_projection_on_edit();


-- =============================================================================
-- 3. tags: slug alias resolution
--
-- next.config.js hardcodes a 308 from /tags/Web3 to /tags/Crypto, and the
-- taxonomy has changed before. As a table lookup the next rename is a row, not
-- a code change plus a deploy.
-- =============================================================================

CREATE OR REPLACE FUNCTION resolve_tag_slug(candidate text)
RETURNS text AS $$
  SELECT coalesce(
    (SELECT slug FROM tags         WHERE slug = candidate),
    (SELECT t.slug FROM tag_aliases a JOIN tags t ON t.id = a.tag_id
      WHERE a.alias_slug = candidate),
    candidate
  );
$$ LANGUAGE sql STABLE PARALLEL SAFE;

CREATE OR REPLACE FUNCTION tag_is_known(candidate text)
RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM tags         WHERE slug = candidate)
      OR EXISTS (SELECT 1 FROM tag_aliases WHERE alias_slug = candidate);
$$ LANGUAGE sql STABLE PARALLEL SAFE;


-- =============================================================================
-- 4. collections
--
-- A collection defines its own fields (collection_fields); every entry stores
-- a JSON object of values. The public site never queries collections
-- generically — a page reads one named collection and renders it with its own
-- component — so the read path is always "this collection, in this order".
-- There is no public URL for a collection and none is generated.
-- =============================================================================

ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS public_read boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS collections_slug_idx ON collections (slug);

-- Pinned first, then explicit order, then newest. NULLS LAST so an entry
-- created without a sort_order does not jump above deliberately ordered ones.
CREATE INDEX IF NOT EXISTS collection_entries_order_idx
  ON collection_entries (
    collection_id,
    sort_pinned DESC,
    sort_order ASC NULLS LAST,
    created_at DESC
  );
