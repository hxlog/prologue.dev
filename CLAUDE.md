# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A content-first personal blog (Chinese, `prologue.dev`) built on **Next.js 16 App Router + Turbopack, React 19, Tailwind CSS v4, and Contentlayer2**. It doubles as the **source of truth for a public starter template** — see the "Template publishing" section, which is the least obvious part of this codebase.

## Commands

```bash
npm run dev            # contentlayer2 dev + next dev --turbopack (runs both, watch mode)
npm run build          # contentlayer2 build && next build --turbopack
npm run start          # serve production build
npm run build:content  # regenerate .contentlayer only
npm run lint           # eslint (flat config in eslint.config.mjs)
npm run publish:dry    # build the template snapshot locally (no push)
npm run publish        # force-push template to hxlog/prologue-blog-template
```

There is **no test suite**. CI (`.github/workflows/ci.yml`) runs `lint` + `build` only. Verify changes by building and running the site.

Contentlayer2 must run before Next — never call `next build`/`next dev` in a way that skips the content generation step; `npm run dev`/`build` already orchestrate this.

## Content model

All site content and config live under `/data` (static assets in `/public`). Contentlayer (`contentlayer.config.js`) reads `contentDirPath: ./data/content` and emits two document types into `.contentlayer/generated`, imported everywhere as `contentlayer/generated` (a path alias in `jsconfig.json`):

- **`Post`** — `data/content/blog/**/*.md`, `contentType: "markdown"`. Rendered to HTML, exposed as `post.body.html`.
- **`Page`** — `data/content/pages/**/*.md`, `contentType: "mdx"` (note: `.md` extension but treated as MDX). Rendered to MDX bytecode, exposed as `page.body.code`.

Both share `computedFields` (`slug`, `urlslug`, `slugAsParams`, `readingTime`, `headings`). `slug`/`slugAsParams` are **lowercased**; route matching relies on this.

Site-wide settings (title, author, `siteUrl`, Giscus `repoid`/`categoryid`, Umami config) are in `data/sitemetadata.js`. Nav links in `data/headerNavLinks.js`, microblog posts in `data/microblog.yaml`, friend links in `data/links.yaml`.

Post frontmatter: `title`, `description`, `publishDate` (required); `lastmod`, `image`, `imageDesc`, `draft`, `featured`, `tags`, `categories` (optional). Set `draft: true` to exclude a post from feeds/sitemap and make its route 404.

## Markdown pipeline & Mermaid

The markdown pipeline is configured in `contentlayer.config.js` (remark: gfm, math, gemoji; rehype: katex, slug, custom `rehype-figure`, custom `rehype-mermaid-pre`, stringify, shiki). Custom rehype plugins live in `src/components/`.

`rehype-mermaid-pre` converts ```mermaid code fences into `<pre class="mermaid">` blocks. Mermaid is then rendered **two different ways** depending on the consumer — keep both in sync if you touch either:

- **On the web**: `OptimizedHTMLRenderer` (`src/components/optimized-html-renderer.js`) parses `post.body.html`, routing `<img>` to `next/image` and `<pre class="mermaid">` to the client-side `MermaidBlock` (dynamic-imports `mermaid`, theme-aware); everything else goes through `dangerouslySetInnerHTML`.
- **In feeds**: `src/lib/feed/mermaid.js` + `mermaid-shared.mjs` rewrites the same `<pre>` blocks into hosted `mermaid.ink` PNG `<img>` URLs (pako deflate + base64url encoding), since RSS readers strip inline SVG.

## Feeds (RSS / Atom / JSON)

Routes: `src/app/rss`, `src/app/atomfeed`, `src/app/jsonfeed`. All three call `createFeed()` in `src/lib/feed/build-feed.js`, which builds a single `Feed` instance; each route only picks the serializer (`rss2`/`atom1`/`json1`). Per-item HTML is produced by `buildFeedContent()` in `src/lib/feed/content.js`, which strips KaTeX presentation layers (keeps MathML), promotes block math, absolutizes URLs, and normalizes images. Format-specific fixes the `feed` library can't express (inject `<dc:creator>`, JSON Feed per-item `image`) live in `src/lib/feed/finalize.js`. URL helpers in `src/lib/feed/urls.js` derive absolute URLs from `siteMetadata.siteUrl`.

Feeds are edge-cached (`s-maxage=600, stale-while-revalidate=86400`): content only changes on deploy, so a 10-min staleness window is safe and keeps readers off the function path.

## Template publishing (important)

This repo is mirrored to a public template (`hxlog/prologue-blog-template`) **without the author's posts, maintainer-only files, or personal assets**. On every push to `master`, `.github/workflows/publish-template.yml` runs `npm run publish`, which executes `scripts/publish-template.mjs`. That script:

1. Creates a detached git worktree of `HEAD`.
2. `applyStarterTemplate()` deletes maintainer-only paths (`template/`, `docs/`, `.idea/`, `scripts/`, the publish workflows), wipes `data/content/*` and `public/static`, then copies the starter overrides from `template/` and `README.template.md`.
3. Force-pushes the snapshot to the template repo (auth via `TEMPLATE_REPO_TOKEN` secret, falling back to `gh auth token`).

**Implications when editing:**
- The `template/` directory and `README.template.md` are the starter's overrides — they are *not* used by this site but *are* what template users receive. Edit them when you intend to change the template's default content/assets.
- Anything new added for the template must be placed under `template/` (or whitelisted in `applyStarterTemplate`), or it won't ship.
- `publish-template.mjs` references `src/lib/feed/mermaid-manifest.json` and a `docs/` dir that don't currently exist — these are harmless leftovers, not bugs to "fix" by creating the files.
- Locally, use `npm run publish:dry` to preview the snapshot (written under `.tmp/`, which is gitignored); only `npm run publish` pushes.

## Design system

Semantic tokens live in `src/app/globals.css` under `@theme inline` (`background/foreground/surface/surface-2/surface-3/muted/faint/border/border-strong/accent/accent-strong/accent-soft/secondary/secondary-soft`, radii, shadows, motion), mapped to CSS variables that flip under `.dark`. **Primary accent = cyan, secondary = violet** (analogous cool pair); interactive states use `accent`, emphasis/badges use the cyan→violet `--gradient-brand`. The v3-style `tailwind.config.js` (loaded via `@config`) holds only `darkMode: ["class"]` + the typography plugin. Fonts are self-hosted via `next/font/google` in `layout.js` (Noto Sans SC / Noto Serif SC / JetBrains Mono).

Shared UI primitives: `card.js` (hairline ring + hover lift; used by home, `/blog`, `/tags/*`, related posts), `tag-chips.js` (responsive +N collapse, expand-in-place), `modal.js` (+ `rss-modal.js` / `email-modal.js`, both copy-to-clipboard with manual-copy fallback), `search-grid.js` (shared search + load-more list). Custom `.prose` overrides in globals.css must keep their `:not(.not-prose *)` guards or they leak into card UI.

Tags: canonical slugs are English (15-tag taxonomy), Chinese display labels live in `data/tagLabels.js`. Tag URLs are `/tags/<EnglishSlug>`; `/tags/Web3` permanently redirects to `/tags/Crypto` (`next.config.js` redirects).

## Routing overview

- `/` — home (`src/app/page.js`): featured grid + Latest/tag/Search tabs (client-side `Articles`, load-more in batches of 8) + about/terminal/microblog sidebar.
- `/blog` — archive with tag sidebar, site-wide Fuse.js search and load-more (numbered pagination removed; `/blog/page/*` redirects to `/blog`).
- `/blog/[...slug]` — a post. Matches via `post.slugAsParams` against `allPosts`; includes related posts (`lib/related.js`: tag overlap + recency, excludes prev/next) and a CSS scroll-driven reading-progress bar.
- `/[...slug]` — MDX pages (e.g. `/about`). Matches via `allPages`.
- `/tags/[...slug]` — tag pages, **statically prerendered** via `generateStaticParams` from `lib/tag-counts.js`; same cards/search/load-more as `/blog`.
- `/microblog`, `/links` — microblog, friend links.
- `/og` — dynamic Open Graph image (Edge runtime, per-title Noto Sans SC subset, CDN-cached).
- `sitemap.js`, `robots.js`, and the feed routes handle SEO/discovery; tag pages are listed in both.

## Conventions & gotchas

- JS (not TS) throughout; most imports are **relative**, even though `jsconfig.json` defines `@/*` → `./src/*` (the alias is currently unused).
- `next.config.js` wraps config in `withContentlayer` (next-contentlayer2). The empty `turbopack: {}` is intentional — it silences a Next 16 warning about Contentlayer's injected webpack config; don't remove it.
- Tailwind is **v4** (`@tailwindcss/postcss` + `@import "tailwindcss"` in `globals.css`) loading a minimal v3-style `tailwind.config.js` via `@config` (typography plugin + `darkMode: ["class"]`). All colors/radii/shadows/motion are tokens in `globals.css` `@theme inline`.
- `/_next/image` responses carry `Content-Disposition: inline` natively via `images.contentDispositionType` in `next.config.js` (Next's optimizer defaults to `attachment`, which makes direct opens download). There is no middleware and no vercel.json; don't re-add override layers.
- Analytics is self-hosted **Umami** (`src/components/umami-analytics.js`, config in `siteMetadata.umami`); it only loads in production. Comments are **Giscus** (`src/components/comments.js`).
- Search is **one site-wide Fuse.js implementation** (`src/lib/use-post-search.js`) over a build-time slim index `public/search-index.json` (`scripts/build-search-index.mjs`, gitignored, regenerated by `npm run build`/`dev`; the publish script whitelists the generator for the template). The index includes Chinese tag labels so CJK queries hit English tags.
- **Image lightbox is wired through CSS classes, not props**: `rehype-figure` tags every post image with `lightbox-image`, `OptimizedHTMLRenderer` preserves that class when swapping in `next/image`, and the globally mounted `ImageLightbox` (root layout) scans the DOM for `img.lightbox-image` and opens a `yet-another-react-lightbox`. Dropping the class anywhere breaks zoom.
- Dates are formatted with `src/lib/date.js` (Intl, zh-CN long form; Beijing time when a clock time is involved) and sorted with `date-fns` (`compareDesc`). Never reintroduce moment.
- Shiki emits only `--shiki-light`/`--shiki-dark` vars (`defaultColor: false` in `contentlayer.config.js`); the active color is applied by CSS in globals.css.
- `.contentlayer`, `.next`, and `.tmp` are generated — never edit by hand.
