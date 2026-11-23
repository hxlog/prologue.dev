# 2026-11-23 build-only static cache + pre-generated images

## Goal
Make prologue.dev behave like a build-only static site behind Cloudflare:
- content changes only on a new build; edge HTML/RSC/feeds are cached until the deploy purges them;
- every displayed bitmap is a build-time WebP thumbnail; the lightbox shows the original and offers a download button;
- CI (lint/build/e2e), template publish and Fly deploy all stay green.

## Decisions (user Q1-Q10)
- Q1 A: build-only cacheLife + Cloudflare long cache + deploy purge.
- Q2 A+B: WebP thumbnails, content widths 480/720/1080/1440/1920/2048, small widths 64/96/128/256.
- Q3 A: only referenced bitmaps (not every file in public/static).
- Q4 A: generate at build into public/static/variants (gitignored), manifest data/image-variants.js generated.
- Q5 A: keep Cache Components + Partial Prefetching; cache final HTML/RSC at the edge.
- Q6 A: cache HTML+RSC at Cloudflare with respect-origin TTL, deploy purge.
- Q7 B: HTML browser cache up to 4h (Cloudflare default), no max-age=0.
- Q8 A: zone-scoped Cache Purge token in GitHub secrets.
- Q9 A: thumbnail first, original upgrade in lightbox, download-original button, same animation/UI.
- Q10 A: push master, green CI, update README/CLAUDE/deploy docs.

## Files / responsibilities
- scripts/build-image-variants.mjs — generate WebP variants + data/image-variants.js; referenced images only.
- src/lib/image-loader.js — next/image custom loader (variant URL, fallback original).
- src/components/optimized-html-renderer.js — content Image keeps original in data-original-src.
- src/app/blog/[...slug]/page.js — cover image uses loader/real size.
- src/components/lightbox-controller.js — slide.original/hires from data-original-src; download name.
- src/components/lightbox-viewer.js + globals.css — download-original control, same transition language.
- next.config.js — images.loader/loaderFile/deviceSizes/imageSizes; cacheLife build profile; headers for /static/variants; remove obsolete optimizer config.
- src/lib/{site-year,projects,rotation}.js, src/lib/{content,feed}/cached.js, src/app/sitemap.js — cacheLife("build").
- src/app/{rss,atomfeed,jsonfeed,microblog/rss}/route.js — long s-maxage, max-age unchanged.
- .github/workflows/deploy-fly.yml — Cloudflare purge after deploy (retry, scoped token).
- scripts/build-e2e.mjs, scripts/publish-template.mjs — run/copy variant generator.
- .gitignore — public/static/variants.
- docs/DEPLOY-FLY.md, CLAUDE.md, README.md — document architecture, image pipeline, cache rules, purge secrets.

## Tasks
1. Image generator + manifest + loader + config; run build; inspect generated count/size.
2. Renderer/cover/lightbox changes; verify HTML has variants, data-original-src and lightbox download.
3. cacheLife build profile and feed/header changes; build route table expected 1y for content/feeds; HTML header s-maxage=31536000.
4. Create scoped CF token, add secrets, update deploy workflow; test purge with token.
5. CF rules: add HTML/RSC catch-all (respect origin), update feeds/SEO static; purge all; verify HIT.
6. Run lint/build/e2e; fix CI/publish/template issues.
7. Deploy; purge; Playwright hard/soft nav + image/lightbox/download; verify cache headers; update docs.

## Verification
- yarn lint, yarn build, yarn build:e2e + yarn test:e2e (CI equivalents).
- Template publish snapshot builds with image variants.
- Cloudflare: HTML/RSC cf-cache-status HIT, API BYPASS, purge changes content; RSC no HTML mixing; 307 not cached.
- Images: thumbnail URLs in HTML; no runtime /_next/image; lightbox original + download; cache HIT.
- All Actions success; both Fly machines healthy.
