-- =============================================================================
-- 0003: fix the CJK tokenizer to be RUN-based, not position-based
--
-- 0002 introduced a bug. Its loop emitted a trailing single character for any
-- CJK run, so:
--     zh_tok('我爱北京天安门')  -> ... '北京':3 ... '门':7
--     zh_q('北京')              -> '北京' & '京'
-- The query demanded a lexeme ('京') that the document never contained, so
-- every 2-character Chinese query silently matched nothing.
--
-- The correct rule is per RUN, not per character:
--   run length >= 2  ->  overlapping bigrams only  (北京 -> 北京 ; 服务端渲染 -> 服务 务端 端渲 渲染)
--   run length == 1  ->  the single character      (so 我 alone is findable)
--
-- Verified against a 2,500-row mixed corpus and the 63 real posts.
-- =============================================================================

CREATE OR REPLACE FUNCTION zh_tok(txt text) RETURNS tsvector AS $$
DECLARE
  s   text := coalesce(txt, '');
  buf text := '';
  r   text;
  k   int;
BEGIN
  -- CJK runs -> overlapping bigrams
  FOR r IN SELECT (m)[1] FROM regexp_matches(s, '([一-鿿]+)', 'g') AS t(m) LOOP
    IF length(r) = 1 THEN
      buf := buf || r || ' ';
    ELSE
      FOR k IN 1..(length(r) - 1) LOOP
        buf := buf || substr(r, k, 2) || ' ';
      END LOOP;
    END IF;
  END LOOP;

  -- latin / digit runs -> one lowercased word each
  FOR r IN SELECT (m)[1] FROM regexp_matches(s, '([A-Za-z0-9_]+)', 'g') AS t(m) LOOP
    buf := buf || lower(r) || ' ';
  END LOOP;

  IF btrim(buf) = '' THEN
    RETURN to_tsvector('simple', '');
  END IF;
  RETURN to_tsvector('simple', btrim(buf));
END
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Query-side companion. MUST be used for anything that may contain CJK.
CREATE OR REPLACE FUNCTION zh_q(q text) RETURNS tsquery AS $$
DECLARE
  s   text := coalesce(q, '');
  buf text := '';
  r   text;
  k   int;
BEGIN
  FOR r IN SELECT (m)[1] FROM regexp_matches(s, '([一-鿿]+)', 'g') AS t(m) LOOP
    IF length(r) = 1 THEN
      buf := buf || r || ' & ';
    ELSE
      FOR k IN 1..(length(r) - 1) LOOP
        buf := buf || substr(r, k, 2) || ' & ';
      END LOOP;
    END IF;
  END LOOP;

  FOR r IN SELECT (m)[1] FROM regexp_matches(s, '([A-Za-z0-9_]+)', 'g') AS t(m) LOOP
    buf := buf || lower(r) || ' & ';
  END LOOP;

  buf := btrim(buf);
  IF buf = '' THEN
    RETURN NULL;
  END IF;
  RETURN to_tsquery('simple', left(buf, length(buf) - 2));  -- drop trailing ' & '
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
-- Recompute the stored vectors.
--
-- search_doc is GENERATED, so changing the function does NOT refresh existing
-- rows -- PostgreSQL only recomputes a generated column when one of its base
-- columns changes. SET EXPRESSION (PG17+) forces a full rewrite and is the
-- supported way to do this; a plain UPDATE would be a silent no-op.
-- =============================================================================

ALTER TABLE search_index
  ALTER COLUMN search_doc SET EXPRESSION AS (
    zh_tok_weighted(title, description, nullif(body_text, ''))
  );
