# Deploying prologue.dev on Fly.io

Self-hosted Next.js 16 (standalone Docker) on Fly.io, behind Cloudflare DNS.
The Fly personal org is on the discontinued **Legacy (Free) Hobby** plan:
3 x shared-cpu-1x 256 MB Machines, 3 GB volumes, 30 GB/month APAC egress.
A paid Fly plan is not available for this project, so the deployment must stay
inside those allowances.

## Topology

~~~
reader -> Cloudflare DNS (proxy for static/og/feeds, DNS-only for HTML)
       -> Fly anycast 66.241.125.18 / 2a09:8280:1::218:8903:0
       -> prologue-dev (sin), 1 x shared-cpu-1x 256MB, swap 512MB
       -> node server.js (Next 16 standalone)
~~~

External services are unchanged: Umami (umami.morean.cn) and Giscus load from
the browser; there is no database or volume.

## Files

| File | Purpose |
| --- | --- |
| Dockerfile | multi-stage Linux build, NEXT_STANDALONE=1, DEPLOYMENT_ID build ARG |
| .dockerignore | keeps node_modules/.next/.git out of the build context |
| fly.toml | app prologue-dev, region sin, 1x256MB, health check, bluegreen |
| .github/workflows/deploy-fly.yml | deploy after CI succeeds on master |
| next.config.js | output gated by NEXT_STANDALONE; deploymentId fallback; www->apex redirect |

## One-time provisioning (already done)

~~~powershell
$fly = "$env:USERPROFILE\.fly\bin\flyctl.exe"
& $fly apps create prologue-dev --org personal
& $fly ips allocate-v4 --shared -a prologue-dev   # 66.241.125.18
& $fly ips allocate-v6 -a prologue-dev            # 2a09:8280:1::218:8903:0
& $fly certs add prologue.dev -a prologue-dev
& $fly certs add www.prologue.dev -a prologue-dev
~~~

Cloudflare records created for certificate validation:

- TXT _fly-ownership.prologue.dev = app-z2gmo1l
- TXT _fly-ownership.www.prologue.dev = app-z2gmo1l
- CNAME _acme-challenge.prologue.dev -> prologue.dev.z2gmo1l.flydns.net
- CNAME _acme-challenge.www.prologue.dev -> www.prologue.dev.z2gmo1l.flydns.net

The deploy token lives in the repo's FLY_API_TOKEN secret:

~~~powershell
& $fly tokens create deploy -a prologue-dev -x 8760h | gh secret set FLY_API_TOKEN --repo hxlog/prologue.dev
~~~

## Deploy

Automatic: push to master -> CI -> "Deploy to Fly.io" workflow ->
flyctl deploy --remote-only --ha=false --build-arg DEPLOYMENT_ID=SHA.

Manual:

~~~powershell
$sha = git rev-parse HEAD
& $fly deploy --remote-only --ha=false --build-arg DEPLOYMENT_ID=$sha
& $fly status -a prologue-dev
& $fly logs -a prologue-dev
~~~

Preview host: https://prologue-dev.fly.dev (health check target /robots.txt;
the same build that will serve prologue.dev).

## DNS cutover (Cloudflare, staged)

Do **not** change traffic DNS until the preview passes the A/B audit. Back up
the two current records first (apex A 76.223.126.88, www CNAME
cname-china.vercel-dns.com) so rollback is one API call.

1. DNS-only (grey cloud):
   - A prologue.dev -> 66.241.125.18
   - AAAA prologue.dev -> 2a09:8280:1::218:8903:0
   - CNAME www.prologue.dev -> z2gmo1l.prologue-dev.fly.dev
   - keep MX/SPF/DKIM/DMARC/x/ENS/verification TXT untouched.
2. fly certs check prologue.dev until Issued.
3. Verify apex and www over HTTPS from several networks; confirm www 301 -> apex.
4. Enable the Cloudflare proxy (orange cloud) and SSL Full (strict);
   redirect rules for www->apex are optional because Next already serves the 301.
5. Add cache rules (below), purge /static/* once, verify with curl -I.

Rollback: restore the two backed-up records; the Fly app stays in place.

## Cloudflare cache policy

Cacheable at the edge (respect origin Cache-Control):

| Path | Origin header | Notes |
| --- | --- | --- |
| /_next/static/* | immutable 1 y | content-hashed |
| /static/opt/* | immutable 1 y | content-hashed derivatives |
| /static/* | 7 d + SWR | purge after deploy |
| /og* | s-maxage=31536000, immutable | avoids 1.3-2.0 s Satori per hit |
| /rss, /atomfeed, /jsonfeed, /microblog/rss | s-maxage=600 | ~1 MB uncompressed; brotli at CF makes it ~100-150 KB |
| /llms.txt, /llms-full.txt, /robots.txt, /sitemap.xml | short | text |

Bypass cache for everything else. **Do not cache HTML/RSC**: App Router
responses vary on the rsc and _rsc headers/query; Cloudflare would have to
forward RSC and key on _rsc, and the origin is a 40 ms Machine in sin anyway.
/_next/image also stays origin-served because the optimizer varies on Accept
(AVIF/WebP).

## Free-tier guardrails

- Compute: exactly one 256 MB Machine (bluegreen briefly runs two during a
  deploy, still inside the 3-VM allowance). Do not add a second always-on app.
- Egress: 30 GB/month APAC. The cache rules above are what keep a 1 MB feed
  from turning into 30 GB of egress; check fly dashboard Billing weekly.
- Images: images.maximumDiskCacheSize = 128 MiB; .next/cache is ephemeral, a
  deploy starts cold (posts are pre-rendered; feeds rebuild in ~0.3 s).
- Rootfs/swap: swap_size_mb = 512 absorbs sharp/Satori spikes; if the Machine
  still OOM-kills, take /og out of the feed fallback first.

## Verification checklist

~~~powershell
$base = "https://prologue-dev.fly.dev"
1..2 | ForEach-Object { curl.exe -sS -o NUL -w "%{http_code} %{time_starttransfer} %{size_download} " $base/ }
curl.exe -sS -o NUL -D - $base/blog/evaluating-ai-data-labeling-accuracy
curl.exe -sS -o NUL -D - $base/rss
curl.exe -sS -o NUL -D - "$base/og?title=Smoke&date=2026-01-01&read=5&tags=AI"
curl.exe -sS -o NUL -D - "$base/api/search?q=AI"
curl.exe -sS -o NUL -w "%{http_code} " $base/foo.txt
~~~

Then run the full A/B audit (local yarn start baseline vs the Fly preview):
status/title/canonical/OG/JSON-LD/body text per URL, feed byte structure,
cache headers, image optimizer, strict 404s, RSC prefetch, Umami/Giscus
requests, console errors. Only after that is green, switch DNS.

## Known deltas vs Vercel

- No Fly CDN: HTML/origin latency comes from sin, not a global edge;
  Cloudflare only helps the cached classes of traffic.
- No Fly region in Hong Kong; the Machine is in Singapore.
- ISR/route caches are per-Machine and lost on deploy; there is exactly one
  Machine, so this is only a cold-start cost.
- No Vercel preview deployments / Web Vitals; use fly logs, Fly Metrics and
  the local yarn build:e2e/Playwright flow for verification.
