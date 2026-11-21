# Deploying prologue.dev on Fly.io

Self-hosted Next.js 16 (standalone Docker) on Fly.io, DNS on Cloudflare.
The Fly personal org is on the discontinued **Legacy (Free) Hobby** plan:
3 x shared-cpu-1x 256 MB Machines, 3 GB volumes, 30 GB/month APAC egress.
A paid Fly plan is not available for this project, so the deployment stays
inside those allowances.

## Current topology (live)

~~~
reader -> Cloudflare DNS (DNS-only, grey cloud)
       -> Fly anycast 66.241.125.18
       -> prologue-dev (sin), 1 x shared-cpu-1x 256MB, swap 512MB
       -> node server.js (Next 16 standalone)

prologue.dev     A     66.241.125.18          (DNS-only)
www.prologue.dev CNAME z2gmo1l.prologue-dev.fly.dev (DNS-only, origin 301 -> apex)
~~~

External services unchanged: Umami (umami.morean.cn) and Giscus load from the
browser; no database or volume.

**Cloudflare proxy (orange cloud) is deliberately OFF.** Enabling it produced
HTTP 525 (origin TLS handshake failed) for every request, from both apex A and
apex CNAME origins, with Full/Full-strict and both TLS 1.3 settings. Cloudflare
in Flexible mode could reach the origin over port 80 (Fly answered 301), so
the failure is specifically Cloudflare-edge -> Fly shared-IPv4 TLS, not DNS or
routing. Cache rules and SSL settings remain prepared in the zone but inactive
until that is resolved. Next options: Fly support ticket, dedicated IPv4
($2/month, not in the free budget), or a Cloudflare Origin CA certificate
import test.

## Files

| File | Purpose |
| --- | --- |
| Dockerfile | multi-stage Linux build, NEXT_STANDALONE=1, DEPLOYMENT_ID build ARG |
| .dockerignore | keeps node_modules/.next/.git out of the build context |
| fly.toml | app prologue-dev, region sin, 1x256MB + 512MB swap, health check, bluegreen |
| .github/workflows/deploy-fly.yml | deploy after CI succeeds on master |
| next.config.js | output gated by NEXT_STANDALONE; deploymentId fallback; www->apex 301 |

## One-time provisioning (done)

~~~powershell
$fly = "$env:USERPROFILE\.fly\bin\flyctl.exe"
& $fly apps create prologue-dev --org personal
& $fly ips allocate-v4 --shared -a prologue-dev   # 66.241.125.18
& $fly ips allocate-v6 -a prologue-dev            # 2a09:8280:1::218:8903:0 (removed while debugging; can re-add)
& $fly certs add prologue.dev -a prologue-dev
& $fly certs add www.prologue.dev -a prologue-dev
~~~

Cloudflare records used for certificate validation (kept): TXT
_fly-ownership.prologue.dev and _fly-ownership.www.prologue.dev = app-z2gmo1l,
plus the _acme-challenge CNAMEs. The deploy token lives in the repo's
FLY_API_TOKEN secret.

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

## Memory constraints (critical)

- 256 MB **without swap** is not viable: a probe machine was OOM-killed
  (next-server anon-rss 159 MB) under 10x /og plus image-optimizer bursts, and
  health checks flapped. Do not remove swap_size_mb from fly.toml.
- Production runs 256 MB + 512 MB swap. A controlled burst (5 distinct /og
  cards then 5 image widths) returned 200s, peaked with ~20 MB more swap in
  use, and health stayed passing; /og TTFB was 1.4-4.2 s per *uncached* card.
  A 2.4 MB animated webp is passed through by next/image (warning only).
- Because there is no CDN, /og is the most expensive origin route. Feed readers
  and social crawlers hitting many distinct /og URLs at once will be slow; if
  it becomes a problem, pre-generate the post cards or move /og behind a cache.
- Images: images.maximumDiskCacheSize = 128 MiB; .next/cache is ephemeral; a
  deploy starts cold (posts are pre-rendered; feeds rebuild in ~0.3 s).

## DNS cutover (done 2026-11-21)

Saved for rollback: apex A 76.223.126.88 (Vercel) and www CNAME
cname-china.vercel-dns.com (Vercel). Rollback is one Cloudflare API PATCH for
each record. MX/SPF/DKIM/DMARC/x/ENS/verification TXT records were untouched.

## Free-tier guardrails

- Compute: exactly one 256 MB Machine. A bluegreen deploy briefly runs two,
  inside the 3-VM allowance; do not add a second always-on app.
- Egress: 30 GB/month APAC. With the CDN proxy off, the 947 KB RSS + 965 KB
  Atom + 967 KB JSON feeds are the main risk; Fly's edge compresses them to
  brotli on the wire, and Cloudflare DNS-only does not cache. Watch Billing.
- Certificates: 2 of the 10 free single-hostname certs used.
- Domain/IPv6: AAAA was removed while debugging; add back only after verifying
  IPv6 TLS from an external network.

## Verification (2026-11-21)

- HTTP A/B (102 URLs: sitemap corpus + feeds + SEO + API + strict 404s):
  identical status/content; only difference was Fly's edge adding
  content-encoding: br (a bandwidth win).
- /og and /_next/image outputs byte-identical; static JS chunks identical;
  CSS chunk hash differs between the Windows local build and the Linux Docker
  build (same rules, image encoder differences only).
- Playwright: 8 desktop + 2 mobile pages, 0 differing pixels except two
  avatar-image optimizations (225 and 9 px: Windows sharp vs Linux sharp),
  no console errors; theme toggle, search dialog, load-more, mobile nav,
  lightbox, RSC navigation, giscus iframe and Umami requests all work on the
  Fly build; live www 301 -> apex verified from HK/JP/SG/US/UK/DE probes.

## Known deltas vs Vercel

- No CDN/edge cache (Cloudflare proxy blocked by the 525 issue above).
- No Fly region in Hong Kong; the Machine is in Singapore.
- ISR/route caches are per-Machine and lost on deploy; there is exactly one
  Machine, so this is only a cold-start cost.
- No Vercel preview deployments/Web Vitals; use fly logs, Fly Metrics,
  yarn build:e2e/Playwright and the local yarn start baseline for verification.
