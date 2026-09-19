-- =============================================================================
-- 0009: redirects
--
-- Renaming a page is the one edit that can break the site for readers who are
-- not looking at it. A post lives at a path its author chose and shares; a page
-- is a URL people type, bookmark and link to — /about, /now, /uses — and those
-- links live outside this database, in other people's bookmarks and other
-- people's posts.
--
-- So a rename leaves a forwarding address, and `redirects` is that address
-- book. It is consulted from the catch-all route, which is where a retired path
-- actually arrives: once `pages.slug` changes, `/old-slug` matches no route at
-- all, falls through to `src/app/(site)/[...slug]/page.js`, and that page turns
-- "no such page" into "that page moved". The alternative — a check in the proxy
-- — was rejected because a proxy runs on the edge runtime, where there is no
-- `pg` to reach, and because a proxy that queried the database on every page
-- view would pay for a feature only a rename uses.
--
-- ## Why 308 and not 301
--
-- `permanent: true` emits 308, which preserves the method. 301 is defined to
-- let a client rewrite POST to GET and browsers disagree about whether to keep
-- the body. 308 says "this moved, permanently, and the request is still a POST"
-- — which is the truth, since nothing about the request changed.
--
-- ## Why `hits` is counted
--
-- Not analytics: /studio already has Umami, and a self-hosted redirect counter
-- is not a traffic source. The count exists so a retirement can be seen to be
-- doing its job. An entry still collecting hits a month after the rename is
-- telling the author something out there still links to the old URL; an entry
-- with zero is a candidate for deletion.
--
-- ## What is NOT in here
--
-- Prefix and edge rules stay in next.config.js. `/blog/page/:page*` is a
-- wildcard and this table matches exact paths only — a pattern column would be
-- a second concept in a table whose entire value is that a lookup is one
-- equality test. `/tags/Web3` also stays there, deliberately unduplicated: two
-- copies of one redirect is how a link works in production and 404s locally.
-- =============================================================================


CREATE TABLE redirects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Path only, leading slash, no query and no origin: a reader may arrive on
  -- any host that serves the site, and the match is on the path in every case.
  source      text NOT NULL UNIQUE,
  destination text NOT NULL,

  -- 301 vs 308, and the distinction is the method. See the header.
  permanent   boolean NOT NULL DEFAULT true,
  hits        bigint  NOT NULL DEFAULT 0,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  last_hit_at timestamptz,

  CONSTRAINT redirects_source_is_a_path  CHECK (source LIKE '/%'),
  CONSTRAINT redirects_dest_is_a_path    CHECK (destination LIKE '/%'),
  CONSTRAINT redirects_not_self          CHECK (source <> destination)
);

-- The hot lookup is an equality probe on `source`, which the UNIQUE index
-- already serves. A second index here would be cost for nothing, and this table
-- is read on the 404 path where latency is most visible.

CREATE TRIGGER redirects_set_updated_at
  BEFORE UPDATE ON redirects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
