# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A content-first personal blog (Chinese, `prologue.dev`) built on **Next.js 16 App Router + Turbopack, React 19, Tailwind CSS v4**, on an **in-repo filesystem content layer** (no Contentlayer). It doubles as the **source of truth for a public starter template** — see the "Template publishing" section, which is the least obvious part of this codebase.

## Commands

```bash
npm run dev            # link static assets + build search index + next dev --turbopack
npm run build          # same prep, then next build --turbopack
npm run start          # serve production build
npm run lint           # eslint (flat config in eslint.config.mjs)

npm run check          # the offline gates (see below)
node scripts/check.mjs prerendered   # every prerendered page's anchors resolve
node scripts/check.mjs feeds         # all four feeds, against a running server
node scripts/check.mjs all           # all three groups

npm run publish        # build the template snapshot locally (dry run — no push)
npm run publish -- --push            # force-push template to hxlog/prologue-blog-template
```

`npm run check` runs five gates as separate child processes and prints a PASS/FAIL table: the `public/static` link (`link verify`), heading-id parity, render equivalence (63 posts, 37 expected diffs), document shape (63 posts), and the starter template's own files.

There is **no test suite**. These gates are the acceptance gate — run them after touching the content layer, the markdown pipeline, or anything that renders. They are **not** part of `build`, and three of them cannot be: the `prerendered` group reads the output in `.next/server/app/**`, `feeds` needs a running server (`npm run start`), and the `template` gate inspects starter files this site never uses. Folding them into `build` would also break the public template, whose clones carry no `scripts/fixtures/` to compare against. CI (`.github/workflows/ci.yml`) runs `lint`, `check` and `build`.

## Content layer

There is **no Contentlayer**. `src/lib/content/` reads `data/content/**` with `fs` and produces the same document shape Contentlayer2 emitted:

- `load.js` — the loader. Reads frontmatter, computes `readingTime`/`headings` eagerly; `body.html` is **lazy and async** (Shiki is the whole cost). `getPosts()`, `getPages()`, `getPost()`, `getPage()`, `getBodyHtml(doc)`, `getAllPostsWithBody()`.
- `pipeline.js` — the one markdown renderer (unified: remark gfm/math/gemoji → rehype katex/slug/figure/mermaid-pre/shiki/stringify). Plugin order and options are copied from the old `contentlayer.config.js` and verified byte-identical against it. **Do not add options to `remarkRehype` or `rehypeStringify`** — Contentlayer called both bare, and raw HTML blocks collapsing to their text content is load-bearing for three posts.
- `slug.js` — the slugger + heading extractor (F2 fix: anchors and ids now come from the same pass).
- `index.js` — the public API, and **the only file carrying `import "server-only"`**. `standalone.js` is the same surface without the guard, for plain `node scripts/…`.

**The exports are functions, not arrays, and the name says so.** `getPosts()` replaces Contentlayer's `allPosts` constant. The markdown is read with `readFileSync`, which no bundler watches, so a module-scope constant freezes at first evaluation and a content edit in `next dev` keeps serving stale HTML. `load.js` therefore checks an mtime+size signature of the tree on each access (~1.2 ms over 64 files vs ~103 ms to re-parse) and re-reads when it changes; the check is skipped entirely under `NODE_ENV=production`. See `current()` in `load.js` for the ENOENT/EBUSY reasoning. Do not "simplify" this back into a constant, and do not cache the returned array across a render.

Frontmatter is validated **loudly**: a mistyped `draft: "false"` (which is what Obsidian's Properties UI writes when the property type is Text) fails the build naming the file and field, where Contentlayer2 warned and silently skipped the document. Pages (`data/content/pages/`) need only `title` and `description`; posts also need `publishDate`.

`data/static/` holds the site's static assets; `public/static` is a **link** to it (created by `scripts/static-assets.mjs link`, which `dev`/`build` run and `npm run check` re-asserts). This arrangement is what lets one Obsidian vault reach every asset — see `docs/CONTENT.md`, and read its "Why there is no link or junction inside the vault" before proposing a junction to solve an asset problem.

## Markdown pipeline & Mermaid

Configured in `src/lib/content/pipeline.js` (remark: gfm, math, gemoji; rehype: katex, slug, custom `rehype-figure`, custom `rehype-mermaid-pre`, shiki, stringify). The custom rehype plugins live in `src/components/`.

`rehype-mermaid-pre` converts ```mermaid code fences into `<pre class="mermaid">` blocks. Mermaid is then rendered **two different ways** depending on the consumer — keep both in sync if you touch either:

- **On the web**: `OptimizedHTMLRenderer` (`src/components/optimized-html-renderer.js`) parses the rendered HTML, routing `<img>` to `next/image` and `<pre class="mermaid">` to the client-side `MermaidBlock` (dynamic-imports `mermaid`, theme-aware); everything else goes through `dangerouslySetInnerHTML`. `MermaidBlock` **replaces** the `<pre>` with a `div.mermaid`, so a rendered page has 0 fences and 1 SVG — anything asserting on fence count is asserting on what is supposed to be gone.
- **In feeds**: `src/lib/feed/mermaid.js` + `mermaid-shared.mjs` rewrites the same `<pre>` blocks into hosted `mermaid.ink` PNG `<img>` URLs (pako deflate + base64url encoding), since RSS readers strip inline SVG.

## Feeds (RSS / Atom / JSON)

Routes: `src/app/rss`, `src/app/atomfeed`, `src/app/jsonfeed`. All three call `createFeed()` in `src/lib/feed/build-feed.js`, which builds a single `Feed` instance; each route only picks the serializer (`rss2`/`atom1`/`json1`). Per-item HTML is produced by `buildFeedContent()` in `src/lib/feed/content.js`, which strips KaTeX presentation layers (keeps MathML), promotes block math, absolutizes URLs, and normalizes images. Format-specific fixes the `feed` library can't express (inject `<dc:creator>`, JSON Feed per-item `image`) live in `src/lib/feed/finalize.js` — note `imageByUrl()` is a function, not a module constant, for the same staleness reason as the loader. URL helpers in `src/lib/feed/urls.js` derive absolute URLs from `siteMetadata.siteUrl`; `coverImageUrl()` falls back to the `/og` generator when a post has no `image`.

Feeds are edge-cached (`s-maxage=600, stale-while-revalidate=86400`): content only changes on deploy, so a 10-min staleness window is safe and keeps readers off the function path.

## Template publishing (important)

This repo is mirrored to a public template (`hxlog/prologue-blog-template`) **without the author's posts, maintainer-only files, or personal assets**. On every push to `master`, `.github/workflows/publish-template.yml` runs `npm run publish`, which executes `scripts/publish-template.mjs`. That script:

1. Creates a detached git worktree of `HEAD`.
2. `applyStarterTemplate()` deletes maintainer-only paths (`template/`, `docs/`, `.idea/`, `scripts/`, the publish workflows), wipes `data/content/*` and `data/static`, then copies the starter overrides from `template/`.
3. Force-pushes the snapshot to the template repo (auth via `TEMPLATE_REPO_TOKEN` secret, falling back to `gh auth token`).

**Implications when editing:**
- The `template/` directory is the starter's overrides — not used by this site, but *is* what template users receive. Edit it when you intend to change the template's default content/assets.
- Anything new added for the template must be placed under `template/` (or whitelisted in `applyStarterTemplate`), or it won't ship. `ensureTemplateInputs()` asserts the required ones exist, so a missing file fails the publish rather than shipping a broken clone.
- Template-critical files that live in `src/` or `scripts/` are copied explicitly by `applyStarterTemplate`: `scripts/build-search-index.mjs` and `scripts/static-assets.mjs`. **Anything the shipped `dev`/`build` scripts invoke must be in that list**, or a fresh clone fails on its first command.
- `template/data/tagLabels.js` and `template/data/static/` are both required inputs; five `src/` files import the former, so a template without it does not build.
- Locally, `npm run publish` builds and inspects the snapshot under `.tmp/` (gitignored) and stops; `npm run publish -- --push` is what force-pushes. CI passes `--push`.

## Design system

Semantic tokens live in `src/app/globals.css` under `@theme inline` (`background/foreground/surface/surface-2/surface-3/muted/faint/border/border-strong/accent/accent-strong/accent-soft/secondary/secondary-soft`, radii, shadows, motion), mapped to CSS variables that flip under `.dark`. **Primary accent = cyan, secondary = violet** (analogous cool pair); interactive states use `accent`, emphasis/badges use the cyan→violet `--gradient-brand`. The v3-style `tailwind.config.js` (loaded via `@config`) holds only `darkMode: ["class"]` + the typography plugin. Fonts are self-hosted via `next/font/google` in `layout.js` (Noto Sans SC / Noto Serif SC / JetBrains Mono).

Shared UI primitives: `card.js` (hairline ring + hover lift; used by home, `/blog`, `/tags/*`, related posts), `tag-chips.js` (responsive +N collapse, expand-in-place), `modal.js` (+ `rss-modal.js` / `email-modal.js`, both copy-to-clipboard with manual-copy fallback), `search-grid.js` (shared search + load-more list). Custom `.prose` overrides in globals.css must keep their `:not(.not-prose *)` guards or they leak into card UI.

**Theme toggle**: `themeswitch.js` wraps the swap in `document.startViewTransition` with a circular `clip-path` reveal (0.618 s) and adds `.theme-vt` for its duration. `clip-path` is not composited, so the smoothness comes from making the reveal the *only* animation running: `html.theme-vt * { transition: none !important }` suppresses every Tailwind `transition-colors`/`transition-all`, which would otherwise crossfade the same theme tokens underneath it. The block also drops the sticky navbar's `backdrop-filter`. `.theme-vt` is removed in `.then(ok, err)` (not `.finally()`-style success-only) so a rejected transition cannot leave it stuck and freeze every transition site-wide. Measured via `document.getAnimations()`: 0 CSSTransitions mid-reveal with the rule, 561 without.

Tags: canonical slugs are English (15-tag taxonomy), Chinese display labels live in `data/tagLabels.js`. Tag URLs are `/tags/<EnglishSlug>`; `/tags/Web3` permanently redirects to `/tags/Crypto` (`next.config.js` redirects).

## Routing overview

- `/` — home (`src/app/page.js`): featured grid + Latest/tag/Search tabs (client-side `Articles`, load-more in batches of 8) + about/terminal/microblog sidebar.
- `/blog` — archive with tag sidebar, site-wide Fuse.js search and load-more (numbered pagination removed; `/blog/page/*` redirects to `/blog`).
- `/blog/[...slug]` — a post. Matches via `post.slugAsParams` against `getPosts()`; includes related posts (`lib/related.js`: tag overlap + recency, excludes prev/next) and a CSS scroll-driven reading-progress bar.
- `/[...slug]` — markdown pages (e.g. `/about`, plain markdown, no JSX). Matches via `getPages()`.
- `/tags/[...slug]` — tag pages, **statically prerendered** via `generateStaticParams` from `lib/tag-counts.js`; same cards/search/load-more as `/blog`. `getTagCounts()`/`getSortedTags()` are functions, not constants, for the same staleness reason as the loader.
- `/microblog`, `/links` — microblog, friend links. `/microblog/rss` is a standalone RSS 2.0 feed for the microblog (full text + images via `content:encoded`, first image as enclosure).
- `/og` — dynamic Open Graph image (Node runtime, per-title Noto Sans SC subset, CDN-cached).
- `sitemap.js`, `robots.js`, and the feed routes handle SEO/discovery; tag pages are listed in both.

## Conventions & gotchas

- JS (not TS) throughout; most imports are **relative**, even though `jsconfig.json` defines `@/*` → `./src/*` (the alias is currently unused).
- **Turbopack is required and `next.config.js` is plain** — no `withContentlayer` wrapper, no plugin. `next dev`/`next build` run directly against the app.
- Tailwind is **v4** (`@tailwindcss/postcss` + `@import "tailwindcss"` in `globals.css`) loading a minimal v3-style `tailwind.config.js` via `@config` (typography plugin + `darkMode: ["class"]`). All colors/radii/shadows/motion are tokens in `globals.css` `@theme inline`.
- `/_next/image` responses carry `Content-Disposition: inline` natively via `images.contentDispositionType` in `next.config.js` (Next's optimizer defaults to `attachment`, which makes direct opens download). There is no middleware and no vercel.json; don't re-add override layers.
- Analytics is self-hosted **Umami** (`src/components/umami-analytics.js`, config in `siteMetadata.umami`); it only loads in production. Comments are **Giscus** (`src/components/comments.js`).
- Search is **one site-wide Fuse.js implementation** (`src/lib/use-post-search.js`) over a build-time slim index `public/search-index.json` (`scripts/build-search-index.mjs`, gitignored, regenerated by `npm run build`/`dev`; the publish script whitelists the generator for the template). The index includes Chinese tag labels so CJK queries hit English tags.
- **Image lightbox is wired through CSS classes, not props**: `rehype-figure` tags every post image with `lightbox-image`, `OptimizedHTMLRenderer` preserves that class when swapping in `next/image`, and the globally mounted `ImageLightbox` (root layout) scans the DOM for `img.lightbox-image` and opens a `yet-another-react-lightbox`. Dropping the class anywhere breaks zoom.
- Dates are formatted with `src/lib/date.js` (Intl, zh-CN long form; Beijing time when a clock time is involved) and sorted with `date-fns` (`compareDesc`). Never reintroduce moment.
- Shiki emits only `--shiki-light`/`--shiki-dark` vars (`defaultColor: false` in the pipeline); the active color is applied by CSS in globals.css.
- `data/.obsidian/` and `.obsidian/` are gitignored and must **never** reach the published template — they can carry plugin credentials (e.g. Livesync).
- `.next`, `.tmp`, and `public/search-index.json` are generated — never edit by hand.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
