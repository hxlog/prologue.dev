# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A content-first personal blog (Chinese, `prologue.dev`) built on **Next.js 16 App Router + Turbopack, React 19, Tailwind CSS v4**, serving its content out of **PostgreSQL**. It is being grown into a self-hosted publishing platform with a `/studio` admin area.

Two things about this repo are unusual and worth knowing before you touch anything:

- **Content is in the database, not in files.** `data/content/**` still exists and is still the import source, but the running site reads `posts` / `post_revisions` / `pages` / `collections` from Postgres. A change to a markdown file has no effect until it is imported.
- **The markdown renderer is a single shared function** (`src/lib/markdown/render.js`). Publishing and preview both call it, which is what makes "the editor previews exactly what will be published" true by construction rather than by maintenance.

## Commands

```bash
npm run dev            # next dev --turbopack
npm run build          # next build --turbopack
npm run start          # serve production build
npm run lint           # eslint (flat config in eslint.config.mjs)
```

There is **no test suite**. CI (`.github/workflows/ci.yml`) runs `lint` + `build` only. Correctness is established by the scripts under `scripts/db/`, which compare against the live site and the database — see "Verification" below. Run those before claiming a content-path change is safe.

Database scripts need the direct (unpooled) connection and do not read `.env.local` automatically:

```bash
node --env-file=.env.local scripts/db/migrate.mjs [--status|--dry-run|--baseline]
node --env-file=.env.local scripts/db/import-posts.mjs [--dry] [--reset]
node --env-file=.env.local scripts/db/import-pages.mjs [--dry] [--reset]
```

## Verification

There is no unit-test suite, so these scripts are the safety net. They are not decoration — each one caught a real defect that a build could not.

| script | what it proves |
|---|---|
| `full-sweep.mjs` | every page the live site serves renders byte-identical visible text. Needs a local server on `:3211`. |
| `compare-feeds.mjs` | all four feeds match production apart from `lastBuildDate`. |
| `check-figure-classes.mjs` | every rendered `<img>` carries a well-formed lightbox class list. |
| `smoke.mjs` | every route responds; CJK search returns hits; microblog guids unchanged. |
| `dump-posts.mjs` | the full reader-visible projection of every post, as text, for diffing before/after a change. |
| `verify-feed-dates.mjs` | stored instants render the same day they do in production. |
| `check-seed-idempotent.mjs` | re-applying the collections seed changes nothing — it is `ON CONFLICT DO NOTHING` throughout, and a deploy must never revert a /studio edit. |

The `/studio` side has its own set, under `scripts/studio/`. They need the local
server on `:3212` (the e2e suite) or `:3211` (the site verifiers) and the direct
connection, and they take a while — run them before claiming a write-path change
is safe.

| script | what it proves |
|---|---|
| `e2e.mjs` | the studio's whole HTTP surface: auth, every screen, the redirect table, the taxonomy, and that `/api/img` 404s what is not published. |
| `write-test.mjs` | publish / revert / restore, and the concurrency refusal. |
| `preview-parity.mjs` | the editor's preview is the stored artifact, byte for byte. |
| `collections-test.mjs` | entry anchors, the field-index projection, partial-update merging. |
| `tags-test.mjs` | a rename leaves a working alias, a tag in use cannot be deleted, an alias cannot shadow a tag. |
| `media-test.mjs` | the store is private, a pathname cannot be client-chosen, and a delete is refused while anything references the object. |
| `blob-probe.mjs` | the store authenticates and answers 403 unauthenticated. Run this first when media misbehaves. |
| `media-reconcile.mjs` | reports (and only under `--fix`, removes) blobs with no row and rows with no object. |
| `sanitize-test.mjs` | the feed sanitizer refuses `javascript:`, `data:`, `on*`, `url()` in a style, and every escaping container — and is a no-op on the markup the renderer actually emits. |
| `feed-before-after.mjs` | the feed pipeline's output against the PREVIOUS revision of the code, so a change to it is measured against its own predecessor rather than against whatever production was built from. |
| `check-imports.mjs` | every relative specifier in `src/` resolves, without a build. Route groups add a directory level; run this after moving anything under one. |

## Database

One database, `prologue`, on a shared self-hosted PostgreSQL 18 cluster. Two neighbouring databases are **never touched**: `postgres` (another project's `bp_*` tables) and `umami`.

See **`db/README.md`** for roles, per-role timeouts, the PgBouncer constraints, and the CJK tokenizer. Read it before writing a query that uses a session-level feature — transaction pooling breaks several of them silently.

Migrations are numbered `.sql` files applied by `scripts/db/migrate.mjs`, each in its own transaction, against the **direct** connection. They are applied by a separate job, **not** during `next build`: Vercel reuses the same `DATABASE_URL` for production and preview, so a build-time migration would let a pull request mutate the production schema.

`src/lib/db/index.js` holds the pool (`query` / `queryOne` / `queryMany` / `withTransaction`). The pool is small on purpose — the cluster's `max_connections` is shared.

### Schema shape

- **`posts` + `post_revisions`** — a post is a row plus an immutable revision history. `posts.draft_revision_id` / `published_revision_id` point at the current ones. Publishing moves a pointer; it never mutates a revision.
- **`pages` + `page_revisions`** — same, for MDX pages. For a page, the `html` column holds **compiled MDX bytecode**, not markup: the renderable artifact for an MDX document is a component.
- **`posts` carries a list projection** (`title`, `description`, `headings`, `reading_time`, `content_hash`) maintained by triggers in migration 0005, so the busiest pages never join.
- **`collections` + `collection_entries`** — the YAML replacement (microblog, links, and future portfolio/film-log). Read in `src/lib/content/collections.js`.
- **`search_index`** — CJK full-text search. See `db/README.md` for why `pg_trgm` and `ts_headline` do not work here.

## Content model

Reading source of truth: `data/content/blog/**/*.md` (posts) and `data/content/pages/*.md` (pages). Collections are **not** in files — they have lived in `collections` / `collection_entries` since the import, `db/migrations/0012_seed_collections.sql` is what a fresh database gets, and `/studio/collections` is how they are edited. `data/*.yaml` and `scripts/db/import-collections.mjs` were retired with the last commit that could still write them.

Post frontmatter: `title`, `description`, `publishDate` (required); `lastmod`, `image`, `imageDesc`, `draft`, `featured`, `tags` (optional). The whole corpus uses only these eight keys.

`src/lib/content/frontmatter.js` is the one frontmatter parser. It **does not resolve dates** — deliberately. `2025-02-15` is a valid YAML timestamp and would become a `Date` in the reader's zone, while `2025-2-15` is not and would stay a string, so two alike-looking dates would arrive as two different kinds of value. Everything goes through `parseContentDate` (`src/lib/content/dates.js`), which normalises every accepted form to an explicit UTC instant. That function is why 6 of 63 posts no longer render a different day locally than in production.

Slugs: `slug`/`slugAsParams` are **lowercased** and route matching relies on it. `posts.source_path` preserves the real filename, because the "view on GitHub" link is built from it and GitHub is case-sensitive. Never lowercase it.

## Markdown pipeline & Mermaid

The pipeline is `src/lib/markdown/render.js` (remark: frontmatter, gfm, math, gemoji; rehype: katex, slug, custom `rehype-figure`, custom `rehype-mermaid-pre`, stringify, shiki). Custom rehype plugins live in `src/components/`.

`RENDERER_VERSION` in that file must be bumped whenever the pipeline or any remark/rehype/shiki dependency changes in a way that can alter output. Rows with a lower stored version are stale and need re-rendering. This is load-bearing: upgrading `@shikijs/langs` alone was measured to change token colours in 2 of 63 posts with no config change at all.

`rehype-mermaid-pre` converts ```mermaid fences into `<pre class="mermaid">`. Mermaid is then rendered **two different ways** — keep both in sync:

- **On the web**: `OptimizedHTMLRenderer` (`src/components/optimized-html-renderer.js`) parses the stored HTML, routing `<img>` to `next/image` and `<pre class="mermaid">` to the client-side `MermaidBlock`; everything else goes through `dangerouslySetInnerHTML`.
- **In feeds**: `src/lib/feed/mermaid.js` + `mermaid-shared.mjs` rewrite the same blocks into hosted `mermaid.ink` PNG URLs, since RSS readers strip inline SVG.

## Feeds (RSS / Atom / JSON)

Routes: `src/app/rss`, `src/app/atomfeed`, `src/app/jsonfeed`. All three call `createFeed()` in `src/lib/feed/build-feed.js`; each route only picks the serializer. Per-item HTML comes from `buildFeedContent()` in `src/lib/feed/content.js`. Format-specific fixes the `feed` library can't express live in `src/lib/feed/finalize.js`. URL helpers in `src/lib/feed/urls.js`.

Feeds are edge-cached (`s-maxage=600, stale-while-revalidate=86400`).

**Feed HTML is assembled by string surgery** — a stack of regex passes (strip KaTeX presentation, promote block math, absolutise URLs) rather than a DOM traversal. Those passes ADD structure; they are not a defence and must not be mistaken for one, which is why `src/lib/feed/sanitize.js` runs LAST, over the finished artifact, as a real parse → walk → allowlist → serialize. Its allowlist was measured against the corpus (`feed-survey.mjs`, `feed-props.mjs`) — the property keys it matches are the ones `hast-util-from-html` produces, not the HTML spellings, which is the difference between keeping every code block's colour and silently stripping it. Anything that changes the shape of stored post HTML can break a feed without breaking a page, which is why `compare-feeds.mjs` exists and why `feed-before-after.mjs` measures a pipeline change against the previous revision of the code rather than against the deployed site.

## Media

Bytes live in a **private** Vercel Blob store (`src/lib/media/blob.js` is the only module that touches it); metadata lives in `media`. Images are served exclusively through `/api/img/<pathname>`, which serves anything referenced by a **published** post or page to anyone, and everything else only to a session — as a **404, not a 403**, so a stranger cannot learn that unpublished work exists. Publishing a post is therefore a media-visibility event, which is why `invalidatePost` drops the `media` cache tag.

A pathname is generated on the server, never chosen by the client: `media/<y>/<m>/<8 hex>-<slug>.<ext>`, with the extension derived from an allowlist of MIME types rather than from the filename. `isMediaPathname` is the anchored regex the proxy validates against. SVG is deliberately not on the allowlist — it can carry script, and serving one from the site's own origin is stored XSS against anyone who opens it directly.

Uploads are presigned PUTs straight from the browser to the store, so bytes never pass through a function. **`addRandomSuffix: false` is load-bearing**: the default appends four characters at storage time, which puts the object somewhere the database was never told about and makes the commit step's `head()` say "does not exist". `docs/studio.md` has the full reasoning.

## Design system

Semantic tokens live in `src/app/globals.css` under `@theme inline` (`background/foreground/surface/surface-2/surface-3/muted/faint/border/border-strong/accent/accent-strong/accent-soft/secondary/secondary-soft`, radii, shadows, motion), mapped to CSS variables that flip under `.dark`. **Primary accent = cyan, secondary = violet**; interactive states use `accent`, emphasis/badges use the `--gradient-brand`. The v3-style `tailwind.config.js` (loaded via `@config`) holds only `darkMode: ["class"]` + the typography plugin. Fonts are self-hosted via `next/font/google` in `layout.js`.

Shared UI primitives: `card.js`, `tag-chips.js`, `modal.js` (+ `rss-modal.js` / `email-modal.js`), `search-grid.js`. Custom `.prose` overrides in globals.css must keep their `:not(.not-prose *)` guards or they leak into card UI. `/studio` uses these same tokens — it is the blog's admin, not a separate app with its own look.

Tags: canonical slugs are English (15-tag taxonomy), Chinese display labels live in `data/tagLabels.js`. Tag URLs are `/tags/<EnglishSlug>`; `/tags/Web3` permanently redirects to `/tags/Crypto`.

## Routing overview

- `/` — home: featured grid + Latest/tag/Search tabs (client-side `Articles`, load-more in batches of 8) + about/terminal/microblog sidebar.
- `/blog` — archive with tag sidebar, site-wide search and load-more (`/blog/page/*` redirects to `/blog`).
- `/blog/[...slug]` — a post, with related posts (`src/lib/related.js`) and a CSS scroll-driven reading-progress bar.
- `/[...slug]` — MDX pages (e.g. `/about`), matched via `allPages`.
- `/tags/[...slug]` — tag pages, statically prerendered via `generateStaticParams`.
- `/microblog`, `/links` — collections-backed pages. `/microblog/rss` is a standalone RSS 2.0 feed for the microblog.
- `/api/search` — the search endpoint (see below).
- `/api/img/[...path]` — the authenticated image proxy for the private Blob store. The only way any uploaded image is served.
- `/og` — dynamic Open Graph image, per-title Noto Sans SC subset, CDN-cached.
- `sitemap.js`, `robots.js`, and the feed routes handle SEO/discovery.

## Conventions & gotchas

- JS (not TS) throughout; most imports are **relative**, even though `jsconfig.json` defines `@/*` → `./src/*` (the alias is currently unused).
- Tailwind is **v4** (`@tailwindcss/postcss` + `@import "tailwindcss"` in `globals.css`) loading a minimal v3-style `tailwind.config.js` via `@config`.
- `/_next/image` responses carry `Content-Disposition: inline` natively via `images.contentDispositionType`. There is no middleware and no `vercel.json`; don't re-add override layers.
- Analytics is self-hosted **Umami**; it only loads in production, and view counts are read back **only inside `/studio`** — never rendered on the public site. Comments are **Giscus**, toggleable per post and per page.
- Search runs in PostgreSQL (`src/lib/search.js` + `src/app/api/search/route.js`), with a client wrapper (`src/lib/use-post-search.js`) that adds an LRU and in-flight coalescing. The CJK guard in `search.js` must stay `/[一-鿿A-Za-z0-9_]/`: `\p{Script=Han}` without the `u` flag is not a Unicode property escape at all, and silently matched nothing.
- **Image lightbox is wired through CSS classes, not props**: `rehype-figure` tags every post image with `lightbox-image`, `OptimizedHTMLRenderer` preserves that class when swapping in `next/image`, and the globally mounted `ImageLightbox` scans the DOM for `img.lightbox-image`. Class lists are **arrays** in HAST — never build them by string concatenation, which coerces through `Array#toString` and joins on commas. That bug shipped once (`class="rounded-lg,mx-auto,..."`, 163 of 179 images) and silently killed zoom.
- Dates are formatted with `src/lib/date.js` (Intl, zh-CN long form, UTC-pinned) and sorted with `date-fns`. Never reintroduce moment.
- Shiki emits only `--shiki-light`/`--shiki-dark` vars (`defaultColor: false`); the active color is applied by CSS.
- `.next` and `.tmp` are generated — never edit by hand.
- Line endings: content files are LF in the repo and CRLF on a Windows checkout (`core.autocrlf=true`). Every importer normalises to LF at the boundary, because a `\r` inside a `<p>` is invisible in a browser but is literal junk in a feed, a search snippet, or a copy-paste.
