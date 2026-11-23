# Deploying prologue.dev on Fly.io

Self-hosted Next.js 16 (standalone Docker) on Fly.io, with a Cloudflare Tunnel
carrying production traffic and Cloudflare doing TLS 1.3 + edge caching.
The Fly personal org is on the discontinued **Legacy (Free) Hobby** plan:
3 x shared-cpu-1x 256 MB Machines, 3 GB volumes, 30 GB/month APAC egress.

## Why a Cloudflare Tunnel

Cloudflare's edge cannot complete a TLS handshake to Fly's shared IPv4 for this
custom domain: every proxied request returned HTTP 525, on both A and CNAME
origins, under Full and Full (strict), with TLS 1.3 on or off. Importing a
Cloudflare Origin Certificate did not help, and a Worker that fetched the app's
fly.dev hostname failed the same way. Cloudflare Flexible mode could reach the
origin over port 80, so DNS and routing were fine and the failure was specific
to Cloudflare-edge -> Fly inbound TLS.

A Cloudflare Tunnel avoids inbound TLS entirely: cloudflared runs inside each Fly
Machine, opens outbound QUIC connections to Cloudflare, and Cloudflare routes
requests over those connections. This is the architecture in production.

## Current topology (live)

~~~
reader -> Cloudflare edge (TLS 1.3 only, IPv4 + IPv6, cache rules)
       -> Cloudflare Tunnel "prologue-dev" (id 1f5d6f02-86a9-4873-8781-6a9e9169037c)
       -> cloudflared connectors inside each Fly Machine
       -> next standalone on localhost:8080

Machines: sin (primary) + nrt (Tokyo), each shared-cpu-1x 256MB + 512MB swap.
DNS: prologue.dev CNAME <tunnel>.cfargotunnel.com (proxied)
     www.prologue.dev CNAME <tunnel>.cfargotunnel.com (proxied, origin 301 -> apex)
~~~

Cloudflare sends requests to the nearest tunnel connector, so Singapore-side
readers are served by the sin Machine and US/Japan-side probes by the nrt
Machine (verified via the x-fly-region response header: nrt from a US vantage,
sin from Singapore). Custom origin certificates were removed; the Let's
Encrypt certificates for prologue.dev/www remain as direct-fallback certs, and
prologue-dev.fly.dev keeps serving from the same image.

## Files

| File | Purpose |
| --- | --- |
| Dockerfile | Linux standalone build + cloudflared binary + entrypoint |
| scripts/docker-entrypoint.sh | starts node server.js and cloudflared (if TUNNEL_TOKEN set) |
| .dockerignore | keeps node_modules/.next/.git out of the build context |
| fly.toml | two-region rolling deploy, 256MB+512MB swap, health check, HTTP service for fallback |
| .github/workflows/deploy-fly.yml | deploy after CI succeeds on master |
| .github/workflows/monitor.yml | post-deploy external uptime/TLS check |
| next.config.js | standalone gate, deploymentId fallback, www->apex 301 |

## One-time provisioning (done)

~~~powershell
$fly = "$env:USERPROFILE\.fly\bin\flyctl.exe"
& $fly apps create prologue-dev --org personal
& $fly ips allocate-v4 --shared -a prologue-dev
& $fly ips allocate-v6 -a prologue-dev
& $fly certs add prologue.dev -a prologue-dev
& $fly certs add www.prologue.dev -a prologue-dev
& $fly machine clone <sin-machine-id> -a prologue-dev --region nrt --name prologue-dev-nrt
~~~

Cloudflare Tunnel created via API:

~~~powershell
# POST /accounts/<account>/cfd_tunnel  {name:"prologue-dev", config_src:"cloudflare"}
# GET  /accounts/<account>/cfd_tunnel/<id>/token
# PUT  /accounts/<account>/cfd_tunnel/<id>/configurations
#      {"config":{"ingress":[{"service":"http://localhost:8080"}]}}
& $fly secrets set TUNNEL_TOKEN=<token> -a prologue-dev
~~~

The deploy token lives in the repo's FLY_API_TOKEN secret. TUNNEL_TOKEN is a Fly
secret on the app (not in fly.toml, not in git).

## Deploy

Automatic: push to master -> CI -> "Deploy to Fly.io" -> rolling replacement of
all Machines with flyctl deploy --remote-only and the commit SHA as build arg,
then a Cloudflare purge. The deploy workflow uses the scoped
CLOUDFLARE_CACHE_PURGE_TOKEN and CLOUDFLARE_ZONE_ID repository secrets (Cache
Purge permission only; never the global key).

Manual:

~~~powershell
$sha = git rev-parse HEAD
& $fly deploy --remote-only --build-arg DEPLOYMENT_ID=$sha
& $fly status -a prologue-dev
& $fly logs -a prologue-dev
~~~

Rolling deploy replaces one Machine at a time: two steady Machines plus the
third free VM slot absorb the replacement, so the tunnel always has a healthy
connector and there is no downtime.

## Memory constraints (critical)

- 256 MB **without swap** is not viable: a probe machine was OOM-killed
  (next-server anon-rss 159 MB) under a 10x /og plus image-optimizer burst.
- Production runs 256 MB + 512 MB swap on every Machine; the same burst
  returned 200s and the health check stayed passing. cloudflared adds a small
  constant overhead; watch RSS with fly ssh if traffic grows.
- Runtime image optimization is gone (custom loader + build-time variants), so
  there is no .next/cache/images growth on the Machines. The Docker image carries
  the generated thumbnails; .next/cache is still ephemeral and a deploy starts
  cold, but posts/feeds are already pre-rendered.

## TLS, IPv6 and Cloudflare cache rules

- SSL/TLS mode Full (strict), Always Use HTTPS, HTTP/3 and Brotli on.
- Minimum TLS version 1.3 (TLS 1.2 clients are refused).
- IPv6: Cloudflare edge answers AAAA with its own dual-stack addresses; no
  origin AAAA is needed through the tunnel.
- Cache rules (zone Rulesets API, phase http_request_cache_settings):
  - /_next/static/ and /static/ (includes generated /static/variants/) -> cache, respect origin
  - /og* -> cache, respect origin (origin s-maxage=31536000)
  - /rss /atomfeed /jsonfeed /microblog/rss -> cache, respect origin (origin s-maxage=31536000)
  - /llms.txt /llms-full.txt /robots.txt /sitemap.xml -> cache, edge 1 y, browser 4 h
  - /api/* -> bypass cache
  - HTML/RSC catch-all: everything except /api, /_next, /cdn-cgi and /__uptime
    -> cache, edge + browser respect origin
  - /_next/image is only a safety net; next/image now uses the build-time custom
    loader, so the page path no longer requests it.
- Browser TTL: Next sets build-lifetime s-maxage=31536000 without max-age, so
  Cloudflare's default 4-hour browser cache applies (Q7B choice). A deploy purge
  clears the edge, not browsers; repeat visitors can hold an old HTML response
  for up to 4 hours. Static assets and generated thumbnails are content-hashed
  and immutable for a year.
- Verified after deploy: HTML/RSC/feeds/static return cf-cache-status HIT after
  the first request; /api/search stays DYNAMIC/BYPASS; www returns 301 to apex.

## Build-only static caching (2026-11-23)

The site has no runtime data: posts, pages, feeds, sitemap, llms files and the
search index are all produced by the build. The cache chain therefore uses one
lifetime everywhere:

- Next cacheLife: the custom "build" profile (stale/revalidate/expire
  31536000 s) replaces the old max/days/600 s mix. The build table reports
  1y/1y for content and feeds, and every HTML response carries
  s-maxage=31536000.
- Cloudflare caches HTML and RSC with respect-origin, so the CDN holds the same
  build until a deploy purges it.
- The deploy workflow runs POST /zones/<zone>/purge_cache
  {purge_everything:true} after flyctl deploy succeeds. It retries three times
  because the Free plan allows 5 purge requests/minute.
- RSC requests keep the _rsc query parameter in the cache key (Cloudflare's
  default key includes the full query string); the Vary headers Next emits are
  ignored by Cloudflare but _rsc is what separates HTML from RSC. Verify client
  navigation after a deploy; invalid _rsc requests 307-redirect and must not be
  cached.
- The previous 600 s feed window and 30-day max ISR window are gone; there is no
  background revalidation to keep in sync with the CDN.

## Images: build-time WebP thumbnails (current)

`scripts/build-image-variants.mjs` runs before `next build` (and before
`next dev`). It reads every bitmap referenced by the content/data/source tree,
generates WebP sizes 480/720/1080/1440/1920/2048 for content images and
64/96/128/256 for avatars/favicons, writes them to
`public/static/variants/**` (gitignored) and updates
`data/image-variants.js`. Filenames embed a 12-char content hash, so replacing
an image changes its URL and immutable Cloudflare/browser caching stays safe.
`next/image` uses `src/lib/image-loader.js` to map a requested width to the
closest generated variant; SVG/GIF and ungenerated images fall back to their
original URL. The optimized original is kept in `data-original-src`; the
pre-optimization source files are recovered under `public/static/source/**`
(content-hash directories) and mapped by `data/image-sources.js`. The lightbox
starts on the largest generated thumbnail, crossfades the optimized original
over it once decoded, and offers two download actions: `下载当前图片` (the
bitmap currently on screen) and `下载原图` (the true source file). Source files
are immutable under the existing `/static/` cache rule and are excluded from
function tracing; template publishing wipes `public/static` and ships an empty
source map. No `/_next/image` encoding runs at request time.

## Images (2026-11-23 incident)

Symptom: opening an article felt slow, especially images. Diagnosis on the live
site showed this was not a pure CDN problem:

- The client was asking /_next/image for every markdown image and the post
  cover, and Cloudflare had no rule for /_next/image, so each image traversed
  the tunnel to a Fly Machine and ran sharp.
- Cold AVIF was 7.9 s for one image (cold WebP 1.8 s, static file 0.32 s).
  The two Machines keep independent image caches, so a repeat could land on the
  other cold Machine. A page that loaded ~10 images saturated the shared CPU,
  tripped the health check and the watchdog restarted the Machine; during that
  window Cloudflare saw 502s from a still-connected cloudflared connector.
- The AVIF variants were also the source of the lightbox's slow 4K upgrade.

Fix (deployed):

- formats is now WebP-only for the remaining next/image users.
- Markdown images and the post cover render next/image with unoptimized, so
  they are served as plain /static/opt/** files (content-hashed, immutable).
- The post cover takes its real width/height from data/image-sizes.js instead
  of a hard-coded 1920x1080.
- Cloudflare now caches /_next/image at the edge; since output is WebP-only a
  cached response is safe for the browsers that can display it.

Measured after the fix (article page, Fly direct): load 2.7 s (was 13.4 s),
all 9 body images complete, lightbox opens from the already-cached static
file, no 502s. Through Cloudflare: page TTFB 0.47 s, /static image MISS 0.32 s
then HIT 0.31 s.

Compatibility note: /static/opt/** originals are AVIF, so very old browsers
without AVIF support will fall back to a broken image. Current Safari/Chrome/
Firefox all support AVIF; if a WebP fallback set is needed later, generate
responsive WebP files at build time rather than re-enabling the runtime
optimizer.

## Runtime recovery

The entrypoint waits for the local Next server before registering the tunnel
connector, and a watchdog probes /robots.txt on localhost:8080 every 30 s. Three
consecutive failures terminate the container so Fly restarts the Machine and
cloudflared reconnects. This was added after one sin Machine stayed "started"
with a failing health check and cloudflared still connected: Cloudflare returned
502 for requests routed to that connector until the Machine was restarted.

## Cloudflare security posture (edge)

- Browser Integrity Check is **off**: with the orange cloud on, Cloudflare's
  BIC returned 403 to non-browser clients (feed readers, CI curl), which would
  break RSS distribution. Security level stays at medium; WAF managed rules are
  not enabled on the free plan.
- The zone's old custom WAF rule that blocked verified AI crawlers
  (cf.verified_bot_category eq "AI Crawler") was removed: robots.txt explicitly
  permits retrieval-oriented AI agents, so blocking them at the edge would
  contradict the site policy.
- Feed readers (Feedly/Inoreader UA), a plain curl and a GPTBot UA all get 200
  against the live edge after these changes.

## Monitoring

Two layers:

1. GitHub Actions `monitor.yml` runs after every Deploy workflow (workflow_run)
   and on manual dispatch. It checks apex, www, a post, feeds, search, OG and
   the Fly fallback URL, and asserts TLS 1.3 + a Cloudflare cache header.
   GitHub's scheduled triggers do not fire for this repository (verified with a
   freshly added scheduled workflow), so the schedule entry is kept only as a
   best-effort extra; the post-deploy run is the reliable one.
2. Cloudflare Worker `prologue-uptime` runs on a cron trigger every 5 minutes
   (verified from a KV cron marker), checks `/`, `/rss` and `/api/search`,
   stores the result in KV and alerts through ntfy.sh on failure/recovery.
   Subscribe at https://ntfy.sh/prologue-uptime-f37a4d612589bc0e (anyone with
   the topic URL can read/post, so treat it as a low-sensitivity pager).
   Live status JSON: https://prologue.dev/__uptime (Cloudflare Worker route in
   front of the tunnel, not a Next route). The Worker does not check the direct
   fly.dev endpoint because Cloudflare egress cannot complete TLS to Fly (525);
   the post-deploy GitHub run covers the origin separately.

## Verification (2026-11-21)

- HTTP A/B: 102 URLs (sitemap corpus + feeds + SEO + API + strict 404s) were
  identical between the local yarn start baseline and the Fly origin; only
  transport-encoding and deployment-id values differ.
- Playwright: 8 desktop + 2 mobile pages pixel-identical except two avatar
  image optimizations (Windows sharp vs Linux sharp), zero console errors;
  theme toggle, search dialog, load-more, mobile nav, lightbox, RSC navigation,
  giscus iframe and Umami requests all verified on the Fly build.
- Tunnel/edge: TLS 1.3 only, AAAA dual-stack, cache HITs, x-fly-region shows
  sin from Singapore and nrt from a US vantage, www 301 through Cloudflare.

## Fallback (no Vercel)

If the tunnel or Cloudflare is misconfigured, the Fly app still serves at
prologue-dev.fly.dev. To bypass Cloudflare entirely, point apex A/AAAA and www
CNAME back at the Fly IPs and disable the proxy; the Let's Encrypt certs are
still active for direct TLS.

## Known deltas vs Vercel

- No Hong Kong Fly region; sin + nrt cover the audience with two regions.
- The tunnel is an extra dependency, but it terminates in Cloudflare and every
  Machine runs a connector.
- ISR/use-cache state is per-Machine; two machines means two cold caches and
  two feed rebuilds after deploy.
- No preview deployments or Web Vitals; use fly logs/Metrics, monitor.yml and
  the local Playwright/e2e flow.