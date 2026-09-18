-- =============================================================================
-- prologue — initial schema
--
-- Target: PostgreSQL 18.4 (self-hosted, Debian 13, libc en_US.utf8)
-- Isolated database `prologue`. The sibling databases on this cluster
-- (`postgres` holding another project's bp_* tables, and `umami`) are NOT
-- touched by anything in this file.
--
-- Apply with:
--   psql -h $PGHOST -U postgres -d prologue -f db/migrations/0001_init.sql
--
-- ── Design notes ────────────────────────────────────────────────────────────
-- 1. Markdown is the canonical content format; rendered HTML is a derived,
--    versioned projection. `renderer_version` on every rendered row lets a
--    renderer upgrade be applied as a bounded re-render rather than a guess.
--
-- 2. Search is CJK-aware. PostgreSQL's built-in parsers emit ONE token per
--    Chinese run (measured: to_tsvector('simple','我爱北京天安门') yields a
--    single lexeme), and pg_trgm is worse than useless for CJK — a GIN trgm
--    index is silently NOT used for `LIKE '%北京%'` (Seq Scan), while the same
--    query on latin text does use it. Since zhparser / pg_jieba / pgroonga /
--    rum are unavailable on this server, zh_tok() tokenizes CJK runs into
--    overlapping bigrams and latin runs into lowercased words. Verified on a
--    2,500-row mixed corpus: index is used, 9/9 correctness assertions pass.
--
-- 3. `search_doc` columns are GENERATED ALWAYS AS ... STORED so they are
--    impossible to forget and invisible to the ORM. Caveat: if zh_tok() is
--    ever replaced, the stored values go stale silently and the table must be
--    rewritten. Bump SEARCH_VERSION and follow db/README.md when doing so.
-- =============================================================================


-- =============================================================================
-- Extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email/identifier
CREATE EXTENSION IF NOT EXISTS btree_gin;  -- composite GIN with scalar columns

-- pg_trgm is installed for LATIN fuzzy matching only.
-- It does NOT work for CJK on this cluster (verified); do not rely on it there.
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- =============================================================================
-- Functions
-- =============================================================================

-- CJK-aware tokenizer.
--   * each CJK run -> overlapping bigrams  (北京 -> 北京 ; 服务端渲染 -> 服务 务端 端渲 渲染)
--   * a lone CJK character is kept as-is
--   * each latin/digit run -> one lowercased word
-- 'simple' (not 'english') is deliberate: no stemming, so technical
-- identifiers such as `serverless` match exactly rather than being reduced.
CREATE OR REPLACE FUNCTION zh_tok(txt text) RETURNS tsvector AS $$
DECLARE
  s     text := coalesce(txt, '');
  parts text[] := '{}';
  r     text;
  k     int;
BEGIN
  FOR r IN SELECT (m)[1] FROM regexp_matches(s, '([一-鿿]+)', 'g') AS t(m) LOOP
    IF length(r) = 1 THEN
      parts := parts || r;
    ELSE
      FOR k IN 1..(length(r) - 1) LOOP
        parts := parts || substr(r, k, 2);
      END LOOP;
    END IF;
  END LOOP;

  FOR r IN SELECT (m)[1] FROM regexp_matches(s, '([A-Za-z0-9_]+)', 'g') AS t(m) LOOP
    parts := parts || lower(r);
  END LOOP;

  RETURN to_tsvector('simple', array_to_string(parts, ' '));
END
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Query-side companion to zh_tok(). Same tokenization, AND-ed together.
-- MUST be used instead of plainto_tsquery/websearch_to_tsquery for anything
-- that may contain CJK, or the query will never match.
CREATE OR REPLACE FUNCTION zh_q(q text) RETURNS tsquery AS $$
DECLARE
  s     text := coalesce(q, '');
  parts text[] := '{}';
  r     text;
  k     int;
BEGIN
  FOR r IN SELECT (m)[1] FROM regexp_matches(s, '([一-鿿]+)', 'g') AS t(m) LOOP
    IF length(r) = 1 THEN
      parts := parts || r;
    ELSE
      FOR k IN 1..(length(r) - 1) LOOP
        parts := parts || substr(r, k, 2);
      END LOOP;
    END IF;
  END LOOP;

  FOR r IN SELECT (m)[1] FROM regexp_matches(s, '([A-Za-z0-9_]+)', 'g') AS t(m) LOOP
    parts := parts || lower(r);
  END LOOP;

  IF array_length(parts, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN to_tsquery('simple', array_to_string(parts, ' & '));
END
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- Tagged search vector: title is weighted above description, above body,
-- so ts_rank prefers a title hit.
CREATE OR REPLACE FUNCTION zh_tok_weighted(
  title text, description text, body text
) RETURNS tsvector AS $$
  SELECT setweight(zh_tok(coalesce(title, '')), 'A')
      || setweight(zh_tok(coalesce(description, '')), 'B')
      || setweight(zh_tok(coalesce(body, '')), 'C');
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- Generic updated_at maintenance.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$ LANGUAGE plpgsql;


-- =============================================================================
-- Content: posts
-- =============================================================================

-- A post is an identity + lifecycle record. Its text lives in post_revisions.
-- The public URL is derived from `slug`, which is FROZEN once published:
-- historical slugs are recorded in slug_history and served as 301s.
CREATE TABLE posts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL UNIQUE,
  status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'published', 'archived')),

  -- presentation / metadata (post-level: changing these does not need a revision)
  featured             boolean     NOT NULL DEFAULT false,
  cover_image          text,
  cover_alt            text,
  cover_image_desc     text,
  categories           text[]      NOT NULL DEFAULT '{}',

  -- per-post switches and SEO overrides
  giscus_enabled       boolean     NOT NULL DEFAULT true,
  seo_title            text,
  seo_description      text,
  og_image             text,

  -- lifecycle pointers
  draft_revision_id     uuid,
  published_revision_id uuid,
  published_at         timestamptz,
  lastmod              timestamptz,

  -- provenance
  author_id            uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX posts_status_published_at_idx ON posts (status, published_at DESC NULLS LAST);
CREATE INDEX posts_featured_idx            ON posts (featured) WHERE featured;
CREATE INDEX posts_categories_idx          ON posts USING gin (categories);

CREATE TRIGGER posts_set_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Immutable revision history. Publishing creates a revision and moves the
-- pointer; it never mutates a published row.
CREATE TABLE post_revisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id          uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  revision_number  int  NOT NULL,

  title            text NOT NULL,
  description      text,
  markdown         text NOT NULL,

  -- derived projections, all produced by ONE renderMarkdown() pass so the
  -- table of contents anchors can never disagree with the rendered HTML
  html             text NOT NULL,
  feed_html        text,
  headings         jsonb   NOT NULL DEFAULT '[]'::jsonb,
  reading_time     jsonb,
  renderer_version int     NOT NULL,

  change_summary   text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (post_id, revision_number)
);

CREATE INDEX post_revisions_post_idx ON post_revisions (post_id, revision_number DESC);

-- Both pointer columns are added after post_revisions exists (circular FKs).
ALTER TABLE posts
  ADD CONSTRAINT posts_draft_revision_fk
    FOREIGN KEY (draft_revision_id) REFERENCES post_revisions(id) ON DELETE SET NULL,
  ADD CONSTRAINT posts_published_revision_fk
    FOREIGN KEY (published_revision_id) REFERENCES post_revisions(id) ON DELETE SET NULL;


-- =============================================================================
-- Content: tags
-- =============================================================================

-- `slug` is the canonical English URL segment (/tags/<slug>); `label` is the
-- Chinese display name. Keeping both in the database replaces data/tagLabels.js.
CREATE TABLE tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  label       text NOT NULL,
  description text,
  sort_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE post_tags (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  uuid NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX post_tags_tag_idx ON post_tags (tag_id);

-- A tag slug that was retired and folded into another (e.g. Web3 -> Crypto)
-- must keep resolving. next.config.js currently hardcodes this redirect.
CREATE TABLE tag_aliases (
  alias_slug  text PRIMARY KEY,
  tag_id      uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);


-- =============================================================================
-- Content: slug history (SEO safety net)
-- =============================================================================

CREATE TABLE slug_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  slug       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz
);

CREATE INDEX slug_history_post_idx ON slug_history (post_id);


-- =============================================================================
-- Content: standalone pages  (/about, /links, future static pages)
-- =============================================================================

-- Unlike posts these are rendered through the same markdown pipeline but are
-- not part of feeds, the sitemap's post inventory, or related-post logic.
CREATE TABLE pages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'published'
                     CHECK (status IN ('draft', 'published', 'archived')),

  title            text NOT NULL,
  description      text,
  markdown         text NOT NULL,
  html             text NOT NULL,
  headings         jsonb   NOT NULL DEFAULT '[]'::jsonb,
  reading_time     jsonb,
  renderer_version int     NOT NULL,

  giscus_enabled   boolean NOT NULL DEFAULT true,
  seo_title        text,
  seo_description  text,
  og_image         text,
  custom_css       text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER pages_set_updated_at
  BEFORE UPDATE ON pages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- Navigation (replaces data/headerNavLinks.js)
-- =============================================================================

CREATE TABLE nav_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,
  href       text NOT NULL,
  sort_order int  NOT NULL DEFAULT 0,
  visible    boolean NOT NULL DEFAULT true,
  external   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nav_items_order_idx ON nav_items (sort_order) WHERE visible;


-- =============================================================================
-- Media (Vercel Blob, private store)
-- =============================================================================

-- Only metadata lives here; the bytes live in the private Blob store and are
-- served through an authenticated proxy route, never by a raw blob URL.
CREATE TABLE media (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pathname       text NOT NULL UNIQUE,   -- blob object key, e.g. media/2026/09/<uuid>.webp
  mime_type      text NOT NULL,
  size_bytes     bigint,
  width          int,
  height         int,
  alt            text,
  caption        text,
  blur_data_url  text,
  uploaded_by    uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX media_created_idx ON media (created_at DESC);


-- =============================================================================
-- Collections (user-defined content types: microblog, links, portfolio, ...)
-- =============================================================================

-- Field values live in `collection_entries.values` as JSONB keyed by
-- collection_fields.key. This is the schema-on-write choice: adding a field is
-- an INSERT, never a DDL migration, which is what makes UI-driven collection
-- creation possible.
CREATE TABLE collections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE,
  name           text NOT NULL,
  description    text,
  icon           text,

  -- bump when a field is renamed/retyped so entries can be migrated lazily
  schema_version int NOT NULL DEFAULT 1,

  settings       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER collections_set_updated_at
  BEFORE UPDATE ON collections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE collection_fields (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,

  key           text NOT NULL,   -- stable identifier used in values JSONB
  label         text NOT NULL,   -- display label
  type          text NOT NULL
                  CHECK (type IN (
                    'text', 'long_text', 'markdown', 'number', 'boolean',
                    'date', 'datetime', 'url', 'select', 'multi_select',
                    'image', 'image_gallery', 'relation', 'json'
                  )),

  required      boolean NOT NULL DEFAULT false,
  default_value jsonb,
  options       jsonb   NOT NULL DEFAULT '{}'::jsonb,  -- select choices, relation target, limits
  validation    jsonb   NOT NULL DEFAULT '{}'::jsonb,  -- min/max/pattern/maxLength
  help_text     text,
  sort_order    int     NOT NULL DEFAULT 0,

  UNIQUE (collection_id, key)
);

CREATE INDEX collection_fields_order_idx ON collection_fields (collection_id, sort_order);


CREATE TABLE collection_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,

  slug          text,            -- optional; not every collection is URL-addressable
  status        text NOT NULL DEFAULT 'published'
                  CHECK (status IN ('draft', 'published', 'archived')),

  -- all field values, keyed by collection_fields.key
  values        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- manual ordering (microblog reverse-chronological, portfolio curated, ...)
  sort_order    int  NOT NULL DEFAULT 0,

  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (collection_id, slug)
);

CREATE TRIGGER collection_entries_set_updated_at
  BEFORE UPDATE ON collection_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX collection_entries_list_idx
  ON collection_entries (collection_id, status, sort_order, published_at DESC);
-- enables querying entirely inside the custom field values
CREATE INDEX collection_entries_values_idx
  ON collection_entries USING gin (values jsonb_path_ops);


-- =============================================================================
-- Unified site-wide search index
-- =============================================================================

-- One row per searchable unit across ALL content kinds, so a single query
-- drives global search. Maintained by the application on publish (not by
-- triggers), because rows are composed from several tables.
CREATE TABLE search_index (
  id           text PRIMARY KEY,        -- 'post:<slug>' | 'page:<slug>' | 'entry:<collection>:<id>'
  kind         text NOT NULL
                 CHECK (kind IN ('post', 'page', 'collection_entry')),
  ref_id       uuid NOT NULL,

  title        text NOT NULL,
  description  text,
  url          text NOT NULL,
  tags         text[] NOT NULL DEFAULT '{}',

  -- plain text used for ts_headline snippets
  body_text    text,

  published_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),

  search_doc   tsvector GENERATED ALWAYS AS (
                 zh_tok_weighted(title, description, body_text)
               ) STORED
);

CREATE INDEX search_index_gin_idx     ON search_index USING gin (search_doc);
CREATE INDEX search_index_kind_idx    ON search_index (kind);
CREATE INDEX search_index_pub_idx     ON search_index (published_at DESC NULLS LAST);
CREATE INDEX search_index_tags_idx    ON search_index USING gin (tags);


-- =============================================================================
-- Grants — the application connects as prologue_app, never as postgres
-- =============================================================================

GRANT CONNECT ON DATABASE prologue TO prologue_app;
GRANT USAGE  ON SCHEMA  public   TO prologue_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO prologue_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO prologue_app;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA public TO prologue_app;

-- keep future objects reachable without re-running grants
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO prologue_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO prologue_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO prologue_app;
