-- =============================================================================
-- 0002: auth, page revisions, revision diffing, collection field projection
--
-- Amends 0001. Safe to run on the already-imported database: it only adds
-- tables/columns and rewrites two functions.
-- =============================================================================


-- =============================================================================
-- 1. Rebuild the tokenizer without array_to_string()
--
-- Verified on this server:  array_to_string(anyarray, text) has provolatile
-- = 's' (STABLE), not IMMUTABLE.  Calling a STABLE function from a function
-- you declare IMMUTABLE "works" only because PostgreSQL does not inspect
-- plpgsql bodies — but it is a latent correctness hazard, because the stored
-- tsvector values then depend on a function the planner is entitled to
-- fold/unfold differently.  This version builds the token string with plain
-- text concatenation, whose only dependency (`||` on text) is genuinely
-- immutable.
--
-- Also: no \w, no [[:alpha:]], no lower() on non-ASCII.  Those classes are
-- evaluated against the collation / LC_CTYPE, which would make the output
-- environment-dependent and silently invalidate every stored vector.
-- =============================================================================

CREATE OR REPLACE FUNCTION zh_tok(txt text) RETURNS tsvector AS $$
DECLARE
  s     text := coalesce(txt, '');
  buf   text := '';
  r     text;
  k     int;
  i     int;
  ch    text;
BEGIN
  i := 1;
  WHILE i <= length(s) LOOP
    ch := substr(s, i, 1);

    -- CJK ideograph: start/continue a run of overlapping bigrams
    IF ch ~ '[一-鿿]' THEN
      IF i < length(s) AND substr(s, i + 1, 1) ~ '[一-鿿]' THEN
        buf := buf || ch || substr(s, i + 1, 1) || ' ';
      ELSE
        buf := buf || ch || ' ';
      END IF;
    END IF;

    i := i + 1;
  END LOOP;

  -- latin / digit runs: one lowercased word each
  FOR r IN SELECT (m)[1] FROM regexp_matches(s, '([A-Za-z0-9_]+)', 'g') AS t(m) LOOP
    buf := buf || lower(r) || ' ';
  END LOOP;

  IF btrim(buf) = '' THEN
    RETURN to_tsvector('simple', '');
  END IF;
  RETURN to_tsvector('simple', btrim(buf));
END
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Query-side companion.  MUST be used for anything that may contain CJK:
-- plainto_tsquery / websearch_to_tsquery against a bigram index match nothing.
CREATE OR REPLACE FUNCTION zh_q(q text) RETURNS tsquery AS $$
DECLARE
  s     text := coalesce(q, '');
  buf   text := '';
  r     text;
  i     int;
  ch    text;
BEGIN
  i := 1;
  WHILE i <= length(s) LOOP
    ch := substr(s, i, 1);
    IF ch ~ '[一-鿿]' THEN
      IF i < length(s) AND substr(s, i + 1, 1) ~ '[一-鿿]' THEN
        buf := buf || ch || substr(s, i + 1, 1) || ' & ';
      ELSE
        buf := buf || ch || ' & ';
      END IF;
    END IF;
    i := i + 1;
  END LOOP;

  FOR r IN SELECT (m)[1] FROM regexp_matches(s, '([A-Za-z0-9_]+)', 'g') AS t(m) LOOP
    buf := buf || lower(r) || ' & ';
  END LOOP;

  IF btrim(buf) = '' THEN
    RETURN NULL;
  END IF;
  -- strip the trailing ' & '
  RETURN to_tsquery('simple', left(btrim(buf), length(btrim(buf)) - 2));
END
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

CREATE OR REPLACE FUNCTION zh_tok_weighted(
  title text, description text, body text
) RETURNS tsvector AS $$
  SELECT setweight(zh_tok(coalesce(title, '')), 'A')
      || setweight(zh_tok(coalesce(description, '')), 'B')
      || setweight(zh_tok(coalesce(body, '')), 'C');
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;


-- =============================================================================
-- 2. Authentication — hand-rolled, single author
--
-- Deliberately NOT Better Auth.  The requirement is one email, one password,
-- one authenticator, zero public registration; a general auth library's value
-- lives entirely in the flows that would be disabled here.
-- =============================================================================

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext NOT NULL UNIQUE,
  name           text NOT NULL DEFAULT '槐序',
  password_hash  text NOT NULL,          -- scrypt, self-describing string

  -- TOTP is provisioned but starts disabled; enabling requires proving possession
  totp_secret     text,
  totp_enabled    boolean NOT NULL DEFAULT false,
  totp_verified_at timestamptz,
  -- highest TOTP step already accepted; makes codes single-use (RFC 6238 §5.2)
  totp_last_step  bigint,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per signed-in browser.  The cookie carries a random 256-bit token;
-- only its SHA-256 is stored, so a database read cannot impersonate a session.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  user_agent   text,
  ip           inet
);

CREATE INDEX sessions_user_idx    ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Login throttling.  Keyed by a hash of (ip || email) so the table never
-- stores a plaintext address.
CREATE TABLE login_attempts (
  key_hash   text PRIMARY KEY,
  failures   int  NOT NULL DEFAULT 0,
  first_at   timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);

-- Backup codes: stored hashed, single use.
CREATE TABLE totp_backup_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX totp_backup_user_idx ON totp_backup_codes (user_id) WHERE used_at IS NULL;


-- =============================================================================
-- 3. Pages gain revision history (parity with posts)
--
-- The single flat `pages` row from 0001 is empty, so it is replaced outright.
-- =============================================================================

DROP TABLE IF EXISTS pages;

CREATE TABLE pages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  text NOT NULL UNIQUE,      -- route segment, e.g. 'about'

  status                text NOT NULL DEFAULT 'published'
                          CHECK (status IN ('draft', 'published', 'archived')),

  draft_revision_id     uuid,
  published_revision_id uuid,
  published_at          timestamptz,

  -- per-page presentation switches
  giscus_enabled        boolean NOT NULL DEFAULT true,
  custom_css            text,
  seo_title             text,
  seo_description       text,
  og_image              text,
  show_in_nav           boolean NOT NULL DEFAULT false,
  nav_label             text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER pages_set_updated_at
  BEFORE UPDATE ON pages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE page_revisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id          uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  revision_number  int  NOT NULL,

  title            text NOT NULL,
  description      text,
  markdown         text NOT NULL,

  -- same derived projections as post_revisions; ONE render pass produces both,
  -- so the TOC anchors can never disagree with the rendered HTML
  html             text NOT NULL,
  feed_html        text,
  headings         jsonb NOT NULL DEFAULT '[]'::jsonb,
  reading_time     jsonb,
  renderer_version int NOT NULL,

  -- SHA-256 of `markdown`. Lets autosave skip a no-op write and lets the
  -- version history detect "you are looking at a revision identical to X".
  content_hash     text NOT NULL,

  change_summary   text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (page_id, revision_number)
);

CREATE INDEX page_revisions_page_idx ON page_revisions (page_id, revision_number DESC);

ALTER TABLE pages
  ADD CONSTRAINT pages_draft_revision_fk
    FOREIGN KEY (draft_revision_id) REFERENCES page_revisions(id) ON DELETE SET NULL,
  ADD CONSTRAINT pages_published_revision_fk
    FOREIGN KEY (published_revision_id) REFERENCES page_revisions(id) ON DELETE SET NULL;


-- =============================================================================
-- 4. Post revisions learn to diff
-- =============================================================================

ALTER TABLE post_revisions
  ADD COLUMN IF NOT EXISTS content_hash text;

-- backfill: the digest of the source markdown for already-imported rows
UPDATE post_revisions
   SET content_hash = encode(sha256(convert_to(markdown, 'UTF8')), 'hex')
 WHERE content_hash IS NULL;

ALTER TABLE post_revisions
  ALTER COLUMN content_hash SET NOT NULL;

CREATE INDEX IF NOT EXISTS post_revisions_hash_idx
  ON post_revisions (post_id, content_hash);


-- =============================================================================
-- 5. Collection field projection
--
-- JSONB alone cannot answer "sort/filter entries by a custom field" with an
-- index, and `ORDER BY values->'title'` sorts length-first then bytewise —
-- a bug, not a design. This table is the indexed projection, written by the
-- application inside the same transaction as the entry (never by a trigger:
-- a relation field needs a join and a markdown field needs the renderer).
-- =============================================================================

CREATE TABLE collection_field_index (
  entry_id    uuid NOT NULL REFERENCES collection_entries(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  field_id    uuid NOT NULL REFERENCES collection_fields(id) ON DELETE CASCADE,
  field_key   text NOT NULL,

  value_text  text,
  value_num   numeric,
  value_date  timestamptz,
  value_bool  boolean,
  value_ref   uuid,          -- relation / image targets

  PRIMARY KEY (entry_id, field_id)
);

CREATE INDEX collection_field_index_eq_idx
  ON collection_field_index (field_id, value_text);
CREATE INDEX collection_field_index_num_idx
  ON collection_field_index (field_id, value_num);
CREATE INDEX collection_field_index_date_idx
  ON collection_field_index (field_id, value_date DESC);
CREATE INDEX collection_field_index_ref_idx
  ON collection_field_index (field_id, value_ref) WHERE value_ref IS NOT NULL;
CREATE INDEX collection_field_index_collection_idx
  ON collection_field_index (collection_id);


-- =============================================================================
-- 6. search_index: tags must be a plain column
--
-- A GENERATED column cannot reference another table, so tags cannot be
-- aggregated from post_tags inside the expression. The application writes
-- tags_text alongside the row instead.
-- =============================================================================

ALTER TABLE search_index
  ADD COLUMN IF NOT EXISTS tags_text text NOT NULL DEFAULT '';

ALTER TABLE collection_entries
  ADD COLUMN IF NOT EXISTS sort_pinned boolean NOT NULL DEFAULT false;


-- =============================================================================
-- 7. Grants for the new objects
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO prologue_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prologue_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO prologue_app;
