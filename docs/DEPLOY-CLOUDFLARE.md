# Deploy: Cloudflare Workers Static Assets (static export)

The site is a **Next.js 16 static export** (`output: "export"`) deployed as a
**Cloudflare Worker with static assets only** — no Worker script, no origin, no
server runtime. This is the production target; **Vercel is an equivalent
alternative** for the same codebase (see [DEPLOY-VERCEL](./DEPLOY-VERCEL.md)),
and the published template supports both one-click.

## One-click

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hxlog/prologue-blog-template)

The button clones the template repository and deploys it as an assets-only
Worker. The template ships its own `wrangler.jsonc` + `yarn export` /
`yarn deploy:cf` scripts; this repository uses the same pipeline.

## Static correctness (important)

- Every page awaits its build-time data directly: **no server Suspense fallbacks, no `loading.js`**. The exported HTML contains the full article/body, which is verified with JavaScript disabled in `e2e/static-html.spec.js`; this is both the crawler contract and the fix for the "layout renders but the article stays loading" failure mode.
- **Do not use `prefetch={true}`** on links in this static export. A completed full prefetch can leave a client router-cache entry that makes clicks do nothing; Next's default prefetch strategy is used instead, and short waits show a fixed-size `useLinkStatus` hint.
- `scripts/build-version.mjs` writes `public/version.json` on every build. `VersionGuard` re-fetches it on focus/visibility/pageshow and hard-reloads an open tab when a newer build is deployed. This bounds Cloudflare's documented HTML/asset [version skew](https://developers.cloudflare.com/workers/versions-and-deployments/version-skew/) for long-lived tabs; `staleTimes.static` is 60s for the same reason.

## Why static export

- Next 16 rejects Cache Components / PPR together with `output: "export"`
  ("PPR cannot be enabled in export mode"), so the source is plain static Next:
  every route is prerendered at build, client navigation uses the generated
  RSC payload `.txt` files, and React 19 `<ViewTransition>` keeps working.
- Cloudflare serves asset responses for free and unlimited; the Worker has no
  user code (wrangler adds only an internal no-op for unmatched paths). Free plan
  is sufficient: 20,000 files / 25 MiB per file, custom domains included.
- Everything render-time is generated at build: OG cards (70), RSS/Atom/JSON
  feeds, llms.txt, sitemap.xml, robots.txt, the search index (full + lite).

## Build & deploy

```bash
corepack enable
yarn install --immutable

yarn export        # build-search-index + image variants + OG cards + next build (export) + host files
node scripts/verify-export.mjs   # structural assertions on out/

npx wrangler deploy --config wrangler.jsonc   # assets-only Worker
```

`yarn export` writes `out/` (gitignored) and `scripts/build-cf-assets.mjs`
adds:

- `out/_headers` — feed Content-Type, cache policies (`/_next/static/*` and
  content-hashed image derivatives immutable, HTML `max-age=0, must-revalidate`).
- `out/_redirects` — currently empty; www → apex lives in a zone redirect rule.
- flattened RSC segment payloads (`<route>/__next.<seg>.__PAGE__.txt`) because
  the exported files are nested directories while the client requests dot paths.

## Cloudflare configuration

`wrangler.jsonc` (committed): assets-only, `html_handling: auto-trailing-slash`,
`not_found_handling: 404-page` (this replaces the old `proxy.js` hard-404).
Custom domains are declared as `routes` entries; the zone-internal preview is
`cf.prologue.dev` (workers.dev is DNS-poisoned in mainland China).

Zone-level settings that matter:

- **Cache Rules: none.** Static assets are versioned by the Worker deployment;
  the edge asset cache and `_headers` are the source of truth. Delete the old
  Fly-era cache rules and the post-deploy purge step when the Fly origin is
  decommissioned.
- **Rocket Loader: off** (it breaks Next hydration).
- **Speed Brain / Speculation Rules: off.** They duplicate Next's own prefetch and, on a Worker custom domain, made `/cdn-cgi/speculation` return the SPA's HTML instead of the rules JSON.
- **Cloudflare Workers Builds: disabled** (its trigger was configured as `yarn run build` + `wrangler deploy`, but that build never produces `out/`). GitHub Actions is the single CI/CD path: tests → `yarn export` → verify → deploy → edge purge.
- **Security headers** are generated into `out/_headers`: nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options and a `frame-ancestors 'self'` CSP, inherited by every asset.
- Keep: Always Use HTTPS, HSTS, TLS 1.3, Brotli, HTTP/3, 0-RTT, Early Hints.
- **HTML charset**: Workers Static Assets serves `text/html` without a charset, so a zone Response Header Transform Rule sets `text/html; charset=utf-8` for extensionless HTML paths (`not path contains "."`, not `/static//og/`, and not the four extensionless feed paths). It is scoped to the preview host first and extended to apex/www at cutover.
- **Managed robots / AI crawler controls stay ON**: the zone prepends its
  managed robots block at the edge, which is what production served before the
  migration too (verified: both stacks return the same 3,153-byte `/robots.txt`).
- Do not touch MX / SPF / DKIM / DMARC.

## Verification (acceptance)

```bash
node .tmp/m1/audit.mjs   # 42 checks against BASE_URL (env)
```

The suite covers routes, feeds (Content-Type/counts), llms/sitemap/robots, OG
cards, the 7 hard-404 cases, AVIF→WebP→`img` picture order, lightbox loading,
SPA navigation, ViewTransition activation, theme toggle, client-side search,
SEO/JSON-LD/twitter meta and the Umami tag. Run it against the preview domain
before cutover and against apex/www after.

## Migration status (2026-11-24)

Cutover is **complete**: `prologue.dev` + `www.prologue.dev` are Worker Custom Domains, `www` 301s to apex at the zone edge, `cf.prologue.dev` and the Fly app/tunnel/uptime Worker were removed, and the Fly-era Cache Rules were cleared (no purge step).

## Cutover (approved procedure)

The exact executable plan lives in `.tmp/m1/cutover.mjs` (dry-run by default; `--execute` after approval) with `.tmp/m1/rollback.mjs` as its inverse.

1. Snapshot DNS/rules/settings: `.tmp/m1/zone-snapshot/` (read-only API dump).
2. Build + deploy preview; acceptance on `https://cf.prologue.dev`.
3. Delete the apex and `www` `cfargotunnel.com` CNAMEs (Fly Tunnel).
4. Add `prologue.dev` and `www.prologue.dev` as Worker custom domains
   (`wrangler.jsonc` `routes`), deploy.
5. Add the zone Single Redirect: `www → https://prologue.dev` 301.
6. Re-run acceptance on apex/www + headers/cache + mainland reachability.
7. Keep Fly running with zero traffic for a rollback window; then remove
   `Dockerfile`/`fly.toml`/`deploy-fly.yml`/`monitor.yml`/`__uptime` and the
   zone cache rules + purge secrets.

Rollback: delete the custom domains, recreate the tunnel CNAMEs (the DNS
snapshot has the exact values) — Fly never stopped serving, so this is a
minutes-scale revert.

## Verification results (2026-11-24)

- **Feeds**: W3C Feed Validation Service reports `https://prologue.dev/rss`, `/atomfeed` and `/microblog/rss` as **valid** (the Atom feed's only notes are recommendations: the intentional Folo namespace and two posts sharing a publish date).
- **Lighthouse** (same static build served by the Workers runtime; production measurement from an automated client is polluted by Cloudflare's bot-challenge injection for that client): desktop profile run **100 / 100 / 100 / 100** (performance / accessibility / best-practices / SEO); repeated runs vary 93-100 performance because hydration TBT fluctuates, while accessibility, best-practices and SEO stay at 100. Mobile performance remains below 100 (Next hydration + 4x CPU throttling), tracked as a bundle/hydration follow-up.
- **CI**: the `export` job builds and verifies `out/`; the gated `deploy-cloudflare.yml` runs `wrangler deploy` on master (validated manually). The e2e job prebuilds on a cold runner and needs the longer Playwright webServer timeout.

## Maintenance

- Content change = commit + push; CI builds and deploys a new asset version.
- OG card content: bump `OG_IMAGE_VERSION` in `src/lib/og/keys.js` so
  `?v=` changes and caches refresh.
- New glyph in a post title: run `node scripts/build-og-font.mjs` (network +
  sharp) then `node scripts/build-og-images.mjs --force`; the build script
  warns when a card falls back to Google Fonts.
- Images: add the file under `public/static/`; `scripts/build-image-variants.mjs`
  generates AVIF+WebP variants on the next build (AVIF first, WebP fallback).