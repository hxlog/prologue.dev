# Deploy: Cloudflare Workers Static Assets (static export)

The site is a **Next.js 16 static export** (`output: "export"`) deployed as a
**Cloudflare Worker with static assets only** — no Worker script, no origin, no
server runtime. `next start` / Docker / Fly remain as the historical/rollback
path only (the published template still targets Vercel).

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

## Maintenance

- Content change = commit + push; CI builds and deploys a new asset version.
- OG card content: bump `OG_IMAGE_VERSION` in `src/lib/og/keys.js` so
  `?v=` changes and caches refresh.
- New glyph in a post title: run `node scripts/build-og-font.mjs` (network +
  sharp) then `node scripts/build-og-images.mjs --force`; the build script
  warns when a card falls back to Google Fonts.
- Images: add the file under `public/static/`; `scripts/build-image-variants.mjs`
  generates AVIF+WebP variants on the next build (AVIF first, WebP fallback).