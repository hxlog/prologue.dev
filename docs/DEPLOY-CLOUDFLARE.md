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
- **Do not use `prefetch={true}`** on links in this static export. A completed full prefetch can leave a client router-cache entry that makes clicks do nothing; Next's default prefetch strategy is used instead; pending navigation is covered by the client-only NavigationSkeleton (never a document navigation).
- `scripts/build-version.mjs` writes `public/version.json` on every build. `VersionGuard` checks it on idle load, focus/visibility/pageshow/online and every 5 minutes while visible, hard-reloading an open tab when a newer build is deployed. This bounds Cloudflare's documented HTML/asset [version skew](https://developers.cloudflare.com/workers/versions-and-deployments/version-skew/) for long-lived tabs; `staleTimes.static` is 60s for the same reason.

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


## 2026-11-26 navigation/performance update

This section supersedes older details above where they conflict.

- **Navigation**: the former NavigationWatchdog was removed (its URL check was inverted, so a successful client navigation was followed by a full document reload after 4 s). Internal links now stay client-side. A client-only NavigationSkeleton overlay appears after ~140 ms of a pending route swap, renders null on the server (never in exported HTML), is pointer-events:none and causes no document request.
- **Article priority**: the cover image is loading=eager + fetchpriority=high and has an explicit preload link with href/imageSrcSet/imageSizes. The first body image is eager; later images remain lazy. Markdown tables are wrapped in .table-scroll at build time; wide inline MathML scrolls inside its own box. At 320/375/390 px the document scrollWidth equals the viewport on the table-heavy test post.
- **Progressive work**: mermaid is imported and rendered only when a diagram is within 400 px of the viewport; comments already use an IntersectionObserver; search/modals/lightbox panels remain intent-lazy.
- **Service worker**: node scripts/build-service-worker.mjs runs after the export and writes out/sw.js + out/sw-manifest.json. It precaches the CSS/JS shared by every page, runtime-caches navigations/RSC/static assets, is versioned by version.json, and is registered only in production outside WebDriver. NEXT_PUBLIC_DISABLE_SW=1 disables registration. _headers gives /sw.js and /sw-manifest.json max-age=0, must-revalidate.
- **Headers/cache**: out/_headers now has 20 rules. HTML: browser max-age=0, must-revalidate + edge s-maxage=31536000. RSC *.txt: browser max-age=60 + edge s-maxage=31536000. Feeds/sitemap/robots/search-index/version/SW: must-revalidate. /_next/static, content-hashed image variants and /og: immutable. The deploy workflow purges the whole zone and fails if the purge API does not report success (the long s-maxage makes purge the only invalidation).
- **Early Hints**: the /* _headers rule adds Link: </_next/static/chunks/<shared>.css>; rel=preload; as=style. The zone Early Hints setting must stay ON (currently ON) to emit 103 responses. Verify with curl --http2 -v https://prologue.dev/.
- **Cloudflare-injected scripts**: production HTML currently includes /.webmcp/bridge.js (~75,756 bytes) and Precursor challenge scripts. These are Cloudflare-side features (WebMCP/Challenges), not site code. They remain enabled for now; disable them in the Cloudflare dashboard if AI-agent tooling/continuous bot verification is not required, then re-check the HTML for both strings.
- **Verification**: yarn lint; yarn export; node scripts/verify-export.mjs; yarn budget:export; yarn test:e2e (50 tests); production browser checks for 0 document navigations after a link click, 320/375/390 table layout, hero eager/preload, mermaid lazy, service-worker registration and offline fallback.

## 2026-11-26 tag partial rendering + Cloudflare audit follow-up

- Tag pages now have a persistent `src/app/tags/layout.js`; a tag-to-tag navigation only swaps the TagHeader title plus the card page segment. The sidebar/navbar/footer remain mounted; a client-only TagPending skeleton covers only the title+card column. No document request is made.
- Full Cloudflare cache/CDN audit: `docs/CLOUDFLARE-AUDIT.md`. Verified: `_headers` cache policy matches production, Early Hints 103 works over HTTP/2 after cache warm, browser cache TTL is Respect Existing Headers, no Cache Rules/Page Rules needed, Worker is assets-only.
- Applied Cloudflare changes: Hotlink Protection off (third-party Referer PNG requests were 403 due RSS images; verified 200 after), HSTS max-age raised to 31536000 to match the preload flag, and a Compression Rule added for the Atom/JSON feed MIME types that Cloudflare does not compress by default.
- Kept deliberately: WebMCP and Precursor Cloudflare-injected scripts (user decision; overhead documented in the audit), min TLS 1.3, security level, Cache Reserve/Argo unavailable on the plan, legacy DNS records left pending confirmation.

## 2026-11-26 Content Signals in robots.txt

- `/robots.txt` is now a static route handler (`src/app/robots.txt/route.js`) instead of MetadataRoute.Robots, because Next's robots metadata API cannot emit a `Content-Signal` directive.
- Every User-Agent group declares `Content-Signal: ai-train=no, search=yes, ai-input=no`. The chosen policy allows search indexing/short excerpts but disallows AI training and generative AI/RAG input; adjust the constant if the policy changes.
- `e2e/content-signals.spec.js` and `scripts/verify-export.mjs` enforce the directive on every group; the published template inherits the same route through the normal source copy.
- Optional: Cloudflare AI Crawl Control can manage Content Signals in the dashboard, but the static robots.txt is the source of truth here so it works on Cloudflare and Vercel.

## 2026-11-26 Markdown for Agents content negotiation

- Cloudflare's native Markdown for Agents requires Pro+; this Free zone cannot set `content_converter` (API returns `1015 Not allowed to edit zone setting`). The Cloudflare target now deploys a thin `worker/index.js` with an `ASSETS` binding and `run_worker_first: true`: it serves `out/__markdown/**` when `Accept: text/markdown`, otherwise `env.ASSETS.fetch(request)` returns the unchanged static asset.
- `yarn export` now runs `scripts/build-markdown.mjs` between `next-export` and `build-cf-assets`; the Markdown variants are content-only (nav/footer/asides stripped), carry YAML frontmatter and JSON-LD, and are disabled from indexing via `X-Robots-Tag`. Header rules are now 21 (one added `/__markdown/*` plus global `Content-Signal`).
- This is the only non-static runtime layer. If the zone is upgraded to Pro+, enable native Markdown for Agents and remove `main`/`binding`/`run_worker_first` plus the Worker and build-markdown step; no public URL or content-type contract changes.
- Vercel `yarn build` is unchanged and does not implement request-time Markdown negotiation; the generated Markdown files are only in the Cloudflare `export` path.

## 2026-11-26 RFC 9727 API catalog

- `yarn export`/`yarn build`/`yarn dev` now run `scripts/build-api-catalog.mjs` first, generating `public/.well-known/api-catalog`, `openapi.json` and `api-doc.md` for the configured site URL.
- Cloudflare `_headers` (now 24 rules) serves `/.well-known/api-catalog` as `application/linkset+json`, the OpenAPI document as `application/vnd.oai.openapi+json;version=3.1`, and docs as `text/markdown`; the global `Link` header advertises `rel=api-catalog`. The content-negotiation Worker passes these paths through unchanged.
- `vercel.json` carries matching Content-Type/CORS/revalidation rules for the Vercel target. The generated files are gitignored and rebuilt from `data/sitemetadata.js`.
- Validate with `POST https://isitagentready.com/api/scan {"url":"https://prologue.dev"}`; `checks.discovery.apiCatalog` must be `pass`.

## 2026-11-26 homepage Link discovery relations

- The shared `Link` response header (generated in `scripts/build-cf-assets.mjs`) now carries, on one line, the shared CSS preload plus `rel="api-catalog"`, `rel="service-desc"` (OpenAPI), `rel="service-doc"` (Markdown docs), `rel="describedby"` (`/llms.txt`) and `rel="status"` (`/version.json`).
- This satisfies RFC 8288/RFC 9727 Section 3 discovery on the homepage (and all HTML); `HEAD` carries the same relations. Vercel gets the same machine-resource links from `vercel.json`; Cloudflare's `_headers` is the source of truth for the production path.
- `verify-export.mjs` asserts the relations remain in the combined header; the isitagentready `discoverability.linkHeaders` check additionally confirms them from the public response.

## 2026-11-26 Auth.md agent registration discovery

- `scripts/build-api-catalog.mjs` also writes `public/auth.md` from the site metadata before every build. It is gitignored and served as `text/markdown` by `_headers`/`vercel.json`.
- It also writes OAuth discovery for an **anonymous-only** registration flow: `/.well-known/oauth-protected-resource` (resource, authorization_servers, scopes_supported, bearer_methods_supported:["header"]) and `/.well-known/oauth-authorization-server` (issuer matching PRM, token/registration/revocation endpoints, `agent_auth` with `identity_types_supported:["anonymous"]`, `anonymous.credential_types_supported` and `claim_uri`).
- The Cloudflare Worker implements the matching lightweight endpoints: `POST /agent/auth` (ephemeral anonymous bearer credential), `POST /agent/token`, `GET /agent/claim` (not_required), `POST /agent/revoke` and `GET /agent/authorize`. No human account, email, password or persistent credential is created; public content remains unauthenticated.
- The H1 contains the literal `auth.md`; the document states `This service accepts AI agent registrations` and links the OAuth metadata. The H1/markers/PRM/AS/`agent_auth` chain is what satisfies `check.authMd`. The endpoints are Worker routes, so the Vercel target publishes the discovery documents but not the registration runtime.

## 2026-11-26 A2A Agent Card

- `scripts/build-api-catalog.mjs` now also writes `public/.well-known/agent-card.json` (A2A v1 schema): name/version/description, provider, `supportedInterfaces` (`https://prologue.dev/a2a`, JSONRPC, protocolVersion 1.0), capabilities, default modes and two skills with id/name/description/tags/examples.
- The Cloudflare Worker exposes a minimal `/a2a` JSON-RPC endpoint for `message/send`/`SendMessage` (stateless direct message; no streaming, push notifications or extended card) and returns the same read-only discovery guidance; `/a2a` GET returns service info.
- `_headers`/`vercel.json` serve the card as `application/json` with CORS and revalidation; `verify-export.mjs` asserts the card fields and skills. A2A is intentionally read-only and anonymous, consistent with `auth.md`.
