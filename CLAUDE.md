# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A content-first personal blog (Chinese, `prologue.dev`) built on **Next.js 16 App Router + Turbopack, React 19, Tailwind CSS v4, and Contentlayer2**. It doubles as the **source of truth for a public starter template** — see "Template publishing", which is the least obvious part of this codebase.

The codebase is one generation, one author, and no users: some flows and fields exist because the author wanted them, not because anything depends on them. Conversely, the author has three years of accumulated preference about typography and copy — leave neighbouring prose, card copy and image captions alone unless it is the thing being changed.

A rewrite into a self-hosted publishing platform (Postgres content, `/studio` admin, private Blob media) lives on the `worktree-platform-build` branch. **It is not in `master` and not deployed** — that branch carries its own CLAUDE.md; this file describes `master` only. Branches here are per-feature worktrees that are merged and then deleted, so most of this tree is that accumulation rather than active work.

## Commands

```bash
npm run dev            # contentlayer2 build + search index + (contentlayer2 dev ‖ next dev --turbopack)
npm run build          # contentlayer2 build + search index + next build --turbopack
npm run start          # serve production build
npm run build:content  # regenerate .contentlayer + public/search-index.json
npm run lint           # eslint (flat config in eslint.config.mjs)
npm run publish:dry    # build the template snapshot locally (writes to .tmp/, no push)
npm run publish        # force-push template to hxlog/prologue-blog-template
```

`npm run dev`/`build` orchestrate three steps in order — **contentlayer2 → search index → next**. Running `next build`/`next dev` directly skips content generation and the search index and will produce a site with no content; there is no `prebuild` hook, the ordering only exists inside those two scripts.

There is **no test suite**. CI (`.github/workflows/ci.yml`) runs `lint` + `build` on Node 24 only. Features are accepted by running the site in a browser.

## Content model

All site content and config live under `/data` (static assets in `/public`). Contentlayer (`contentlayer.config.js`) reads `contentDirPath: ./data/content` and emits two document types into `.contentlayer/generated`, imported everywhere as `contentlayer/generated` (a `jsconfig.json` path alias):

- **`Post`** — `data/content/blog/**/*.md`, `contentType: "markdown"`. Rendered to HTML at build time, exposed as `post.body.html`. `data/sitemetadata.js` sets `wordsPerMinute: 1000` for reading time — an intentional choice for CJK, not a typo.
- **`Page`** — `data/content/pages/**/*.md`, `contentType: "mdx"` (note: `.md` extension but treated as MDX). Rendered to MDX bytecode, exposed as `page.body.code`.

Both share `computedFields` (`slug`, `urlslug`, `slugAsParams`, `readingTime`, `headings`). `slug`/`slugAsParams` are **lowercased**; route matching relies on this. The remark chain is hand-assembled (`remarkParse` → `remarkRehype` → gfm/math/gemoji → rehype plugins → `rehypeStringify`), not a preset — adding a plugin means placing it in that explicit order.

Site-wide settings (title, author, `siteUrl`, Giscus `repoid`/`categoryid`, Umami config, `wechatofficialaccount` for the RSS modal's 微信公众号 row) are in `data/sitemetadata.js`. Nav links in `data/headerNavLinks.js`, microblog posts in `data/microblog.yaml`, friend links in `data/links.yaml`.

Microblog entries (`data/microblog.yaml`) support Weibo-style rich content, normalized by `src/lib/microblog.js`: `content` may contain multiple paragraphs (blank-line separated, YAML `|` block), `images` is an optional list of `{src, desc}` (plain-string shorthand allowed). `entryToHtml()` is the single HTML producer — `/microblog` cards and the standalone `/microblog/rss` feed both go through it, and **that shared call is what keeps the on-page entry and its feed copy identical**. Images render in a responsive square-crop grid, carry `lightbox-image` so the global lightbox swipes them, and `desc` surfaces as the lightbox caption (`<figcaption>`, read by `ImageLightbox`). Old `{date, content}` entries remain valid. `getMicroblog()` caches the parsed YAML and is single-instance-only.

Post frontmatter: `title`, `description`, `publishDate` (required); `lastmod`, `image`, `imageDesc`, `draft`, `featured`, `tags`, `categories` (optional; `tags`/`categories` default to `[]`, never `undefined`). Set `draft: true` to exclude a post from feeds/sitemap and make its route 404.

## Markdown pipeline & Mermaid

The markdown pipeline is configured in `contentlayer.config.js`. Custom rehype plugins live in `src/components/` (they are imported by the build config, so keep them dependency-light and free of client code).

`rehype-figure` walks every rendered `<img>`, wraps it in `<figure>` and emits the zoom class as a **space-joined list** (`className` is passed as an array, not a comma-joined string — the comma bug that once broke every lightbox). It is only wired for `Post` bodies; if a plugin ever starts applying to MDX pages, remember `mdxcomponent.js` sets `lightbox-image` by hand.

`rehype-mermaid-pre` converts ```mermaid code fences into `<pre class="mermaid">` blocks. Mermaid is then rendered **two different ways** depending on the consumer — keep both in sync if you touch either:

- **On the web**: `OptimizedHTMLRenderer` (`src/components/optimized-html-renderer.js`) splits `post.body.html`, routing `<img>` to `next/image` (preserving the incoming class list, which is what carries `lightbox-image`) and `<pre class="mermaid">` to the client-side `MermaidBlock`; everything else goes through `dangerouslySetInnerHTML`.
- **In feeds**: `src/lib/feed/mermaid.js` + `mermaid-shared.mjs` rewrite the same `<pre>` blocks into hosted `mermaid.ink` PNG `<img>` URLs (pako deflate + base64url encoding), since RSS readers strip inline SVG.

## Feeds (RSS / Atom / JSON)

Routes: `src/app/rss`, `src/app/atomfeed`, `src/app/jsonfeed`, plus a standalone `src/app/microblog/rss`. The three blog feeds call `createFeed()` in `src/lib/feed/build-feed.js`, which builds a single `Feed` instance; each route only picks the serializer (`rss2`/`atom1`/`json1`). Per-item HTML is produced by `buildFeedContent()` in `src/lib/feed/content.js`, which strips KaTeX presentation layers (keeps MathML), promotes block math, absolutizes URLs, and normalizes images. Format-specific fixes the `feed` library can't express (inject `<dc:creator>`, JSON Feed per-item `image`) live in `src/lib/feed/finalize.js`. URL helpers in `src/lib/feed/urls.js` derive absolute URLs from `siteMetadata.siteUrl`.

All feeds are edge-cached (`public, s-maxage=600, stale-while-revalidate=86400`): content only changes on deploy, so a 10-minute staleness window is safe and keeps readers off the function path. Feed freshness has been a real problem before — see "Conventions & gotchas".

## Template publishing (important)

This repo is mirrored to a public template (`hxlog/prologue-blog-template`) **without the author's posts, maintainer-only files, or personal assets**. On every push to `master`, `.github/workflows/publish-template.yml` runs `npm run publish`, which executes `scripts/publish-template.mjs`. That script:

1. Creates a detached git worktree of `HEAD` at `.tmp/template-worktree`.
2. `applyStarterTemplate()` deletes maintainer-only paths (`template/`, `docs/`, `README.template.md`, `scripts/`, the publish workflows), wipes `data/content/*` and `public/static`, then copies the starter overrides from `template/` and `README.template.md`, and strips the `publish`/`publish:dry` scripts from `package.json`.
3. Force-pushes the snapshot to the template repo (auth via `TEMPLATE_REPO_TOKEN` secret, falling back to `gh auth token`).

**Implications when editing:**
- The `template/` directory and `README.template.md` are the starter's overrides — they are *not* used by this site but *are* what template users receive. Edit them when you intend to change the template's default content/assets.
- `applyStarterTemplate()` is a **denylist**: it ships everything in the tracked tree except the paths it removes. Anything new added for the template must be placed under `template/` (or whitelisted in the script), or it won't ship — and, symmetrically, anything new added for *this site* that isn't denylisted **does** ship. `CLAUDE.md` and `LICENSE` are currently in that leak-through set. If you add a maintainer-only file, add it to the denylist in the same change.
- The script refuses to run against a dirty tree unless `--allow-dirty` is passed (which overlays uncommitted files instead). Locally, use `npm run publish:dry` to preview the snapshot; only `npm run publish` pushes.
- `publish-template.mjs` writes `src/lib/feed/mermaid-manifest.json` into the snapshot, but that path does not exist in this repo. Harmless leftover — do not "fix" it by creating the file.

## Design system

Semantic tokens live in `src/app/globals.css` under `@theme inline` (`background/foreground/surface/surface-2/surface-3/muted/faint/border/border-strong/accent/accent-strong/accent-soft/secondary/secondary-soft`, radii, shadows, motion), mapped to CSS variables that flip under `.dark`. **Primary accent = cyan, secondary = violet** (analogous cool pair); interactive states use `accent`, emphasis/badges use the cyan→violet `--gradient-brand`. The v3-style `tailwind.config.js` (loaded via `@config`) holds only `darkMode: ["class"]` + the typography plugin. Fonts are self-hosted via `next/font/google` in `layout.js` (Noto Sans SC / Noto Serif SC / JetBrains Mono).

Shared UI primitives: `card.js` (hairline ring + hover lift; used by home, `/blog`, `/tags/*`, related posts), `tag-chips.js` (responsive +N collapse, expand-in-place), `modal.js` (+ `rss-modal.js` / `email-modal.js`, both copy-to-clipboard via `use-copy.js` with a manual-copy fallback), `search-grid.js` (shared search + load-more list). Custom `.prose` overrides in globals.css must keep their `:not(.not-prose *)` guards or they leak into card UI. Primary actions are buttons, not underlined links — keep new UI in that idiom.

Tags: canonical slugs are English (15-tag taxonomy), Chinese display labels live in `data/tagLabels.js` and are the single source for cards, chips, tag pages, search and related posts. Tag URLs are `/tags/<EnglishSlug>`; `/tags/Web3` permanently redirects to `/tags/Crypto` (`next.config.js` redirects). Counts come from `lib/tag-counts.js`, which computes from live non-draft posts.

Date handling: `src/lib/date.js` (Intl, zh-CN long form, Beijing time when a clock time is involved) is the only formatter; `date-fns` `compareDesc` is the only comparator.

## Routing overview

- `/` — home (`src/app/page.js`): featured grid + Latest/tag/Search tabs (client-side `Articles`, load-more in batches of 8) + about/terminal/microblog sidebar. The tag tab is a responsive top-3 showcase — a layout decision, not a slice of the tag list.
- `/blog` — archive with tag sidebar, site-wide Fuse.js search and load-more (numbered pagination removed).
- `/blog/[...slug]` — a post. Matches via `post.slugAsParams` against `allPosts`; includes related posts (`lib/related.js`: tag overlap ×10 + recency + featured boost, excludes prev/next) and a CSS scroll-driven reading-progress bar (native `animation-timeline: scroll()`, no JS — keep it CSS-only unless it is the thing being changed).
- `/[...slug]` — MDX pages (e.g. `/about`). Matches via `allPages`.
- `/tags/[...slug]` — tag pages, **statically prerendered** via `generateStaticParams` from `lib/tag-counts.js`; same cards/search/load-more as `/blog`.
- `/microblog`, `/links` — microblog, friend links. `/microblog/rss` is a standalone RSS 2.0 feed for the microblog (full text + images via `content:encoded`, first image as enclosure).
- `/og` — dynamic Open Graph image (Node runtime, per-title Noto Sans SC subset, CDN-cached `s-maxage=604800`).
- `sitemap.js`, `robots.js`, and the feed routes handle SEO/discovery; tag pages are listed in both.

MDX pages render through `mdxcomponent.js` (a single `<Image>` mapping used for every MDX image).

## Conventions & gotchas

- JS (not TS) throughout; every import is **relative**. `jsconfig.json` defines `@/*` but nothing uses it — don't introduce the alias piecemeal.
- `next.config.js` wraps config in `withContentlayer` (next-contentlayer2). The empty `turbopack: {}` is intentional — it silences a Next 16 warning about Contentlayer's injected webpack config; don't remove it. There is no `serverExternalPackages`, and the OG route uses the Node runtime (edge was removed).
- Tailwind is **v4** (`@tailwindcss/postcss` + `@import "tailwindcss"` in `globals.css`) loading a minimal v3-style `tailwind.config.js` via `@config` (typography plugin + `darkMode: ["class"]`).
- `/_next/image` responses carry `Content-Disposition: inline` natively via `images.contentDispositionType` in `next.config.js` (Next's optimizer defaults to `attachment`, which makes direct opens download). There is no middleware and no vercel.json; don't re-add override layers.
- Analytics is self-hosted **Umami** (`src/components/umami-analytics.js`) and only loads when `NODE_ENV === "production"`**and** `siteMetadata.umami.websiteId` is set. Comments are **Giscus** (`src/components/comments.js`).
- Search is **one site-wide Fuse.js implementation** (`src/lib/use-post-search.js`) over a build-time slim index `public/search-index.json` (`scripts/build-search-index.mjs`, gitignored, regenerated by `npm run dev`/`build`; the publish script whitelists the generator for the template). The index includes Chinese tag labels so CJK queries hit English tags. Keying `wordsPerMinute: 1000` and the Fuse `threshold: 0.3` are deliberate CJK tuning.
- **Image lightbox is wired through CSS classes, not props**: `rehype-figure` tags every post image with `lightbox-image`, `OptimizedHTMLRenderer` preserves that class when swapping in `next/image`, and the globally mounted `ImageLightbox` (root layout) scans the DOM for `img.lightbox-image` and opens a `yet-another-react-lightbox`. Dropping the class anywhere breaks zoom.
- Never reintroduce moment (removed; it was a 78KB chunk) or a `page-transition` opacity gate (it delayed LCP until hydration). `page-transition.js` deliberately does not hide content on first paint.
- Shiki emits only `--shiki-light`/`--shiki-dark` vars (`defaultColor: false` in `contentlayer.config.js`); the active color is applied by CSS in globals.css.
- Feed freshness is load-bearing for the site's VXNA listing: feeds once went unindexed for months because `lastBuildDate` had frozen during a publishing gap. Preserve the SWR window and keep `lastBuildDate` derived from real content when touching feed code.
- `.contentlayer`, `.next`, and `.tmp` are generated — never edit by hand.
- Browser verification for UI changes is a Chrome DevTools pass at three widths (desktop / tablet / phone); lint+build alone has historically missed real visual regressions.
