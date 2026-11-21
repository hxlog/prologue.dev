# Fly.io migration audit - 2026-11-21

Commit deployed: 1c8c724bedb03ab6ec7b9e5c25cbb6a99dd3e9fb (master, after merging
fix/atom-feed-folo). App: prologue-dev, region sin (Singapore), 1 x shared-cpu-1x
256 MB + 512 MB swap. Baseline: the same commit built locally with
yarn build (NEXT_STANDALONE unset) and served with node_modules/next/dist/bin/next
start -p 3100 on Windows; the Fly build is the Linux standalone Docker image.

## HTTP parity (102 URLs)

URLs: all URLs from /sitemap.xml plus /blog, /ui, /microblog, /links, /about,
the four feeds, llms.txt/llms-full.txt/robots.txt/sitemap.xml, favicons,
search API queries, and the strict-404 probes /foo.txt, /blog/page/2,
/tags/Web3.

Result: 102/102 identical status codes and content (title, canonical,
description, OG/Twitter tags, JSON-LD, body text hash). The only reported
difference was Cloudflare's edge adding content-encoding: br in DNS-only mode
(a transfer-size win, not a content change).

Additional byte checks:
- /og for the same query: identical SHA-256.
- /_next/image for the same source+width: identical SHA-256, inline
  Content-Disposition, public max-age=2678400.
- Feeds: byte-identical after dpl normalisation (947,250 B RSS on the wire,
  965 KB Atom, 967 KB JSON); Fly's edge brotli-compresses them.
- _next/static JS chunks: identical hashes. The one difference between the
  Windows local build and the Linux Docker build is the CSS chunk filename
  (content hash) and ~900 bytes of generated CSS; Playwright rendered every
  sampled page pixel-identically, so the difference is build nondeterminism,
  not a styling regression.
- HTML headers match: s-maxage=2592000, stale-while-revalidate=28944000,
  x-nextjs-cache: HIT, Vary: rsc/.../Accept-Encoding. ETag differs only because
  of the ?dpl= deployment id.
- Strict 404s and the www-to-apex 301 were verified against the Fly origin.

## Browser parity (Playwright, Chromium)

Desktop 1366x900 and mobile 390x844 screenshots for /, /blog, a post, /tags/AI,
/microblog, /links, /about, /ui.

- Pixel diff: 0 for 8 of 10 pages; /about 225 px and /links 9 px, both traced
  to the same avatar images being re-encoded by Windows sharp locally vs Linux
  sharp on Fly (sub-pixel encoder difference), not a layout or data change.
  Body text for /about and /links is identical.
- Console/page errors: 0 on the Fly build for every page (the local baseline
  logged two 404 resource errors; target had none).
- Interactions: theme toggle (html.dark), search dialog open/type, /blog
  load-more (8 -> 16 cards), client-side RSC navigation (44 _rsc requests,
  window marker survived, URL correct), mobile menu open/Esc, lightbox
  open/Esc, Giscus iframe mounted after scrolling to #comments (18 giscus
  requests), Umami script+recorder requests fired.
- Caveat: the first interaction pass under-reported Giscus/mobile-menu because
  the 256 MB machine answers slowly on a cold cache; a second pass with longer
  waits matched the baseline exactly.

## Memory / stress

A 256 MB probe machine WITHOUT swap was OOM-killed under a 10x /og plus
image-optimizer burst (next-server anon-rss 159 MB; peaks 153-159 MB; health
checks flapped). Do not run this app on 256 MB without swap.

The production machine has swap_size_mb = 512. Controlled burst (5 distinct
/og cards, then 5 image widths): all 200, /og TTFB 1.4-4.2 s per uncached card,
images 0.3-0.4 s, swap use grew ~20 MB and recovered, health stayed passing,
no OOM lines in fly logs. Real traffic is far below that burst level.

## DNS cutover

Cloudflare zone prologue.dev (Free plan). Changed only the two traffic records:
- prologue.dev A: 76.223.126.88 (Vercel) -> 66.241.125.18 (Fly), DNS-only.
- www.prologue.dev CNAME: cname-china.vercel-dns.com -> z2gmo1l.prologue-dev.fly.dev, DNS-only.
- Apex AAAA was removed during debugging and is currently absent.
Rollback values are saved in .tmp/audit/cf-dns-backup.json and in the runbook.
MX/SPF/DKIM/DMARC/x.prologue.dev/ENS verification TXT were untouched.

Fly certificates for prologue.dev and www.prologue.dev are Issued (Let's
Encrypt, rsa+ecdsa). Post-cutover probes from Hong Kong, Japan, Singapore, the
US, UK and Germany: apex 200, www 301 to apex, /rss 200.

## Cloudflare proxy (orange cloud) - blocked

Enabling the proxy returns HTTP 525 (SSL handshake failed) for every request:
- apex A origin and apex CNAME origin, both hosts, both Full and Full (strict);
- TLS 1.3 on and off; TLS 1.2/1.3 handshakes from outside Cloudflare succeed
  (Node TLS, curl, and Fly's own fly.dev endpoint).
- Flexible mode reaches the origin over port 80 (Fly answers 301), so DNS and
  routing are correct and the failure is TLS-specific between Cloudflare's edge
  and Fly's shared IPv4.
The proxy was therefore left OFF and the site runs DNS-only. Cache rules and
SSL settings remain in the zone but inactive. Next options: Fly support ticket,
dedicated IPv4 (2 USD/month, outside the free budget), or a Cloudflare Origin
CA certificate import test.

## Known deltas vs Vercel

- No CDN/edge cache while the proxy is blocked: origin TTFB from HK/JP/SG is
  roughly 150-500 ms for HTML; Vercel China CDN was faster.
- No Hong Kong Fly region; the Machine is in Singapore.
- ISR/use-cache state is per-Machine and lost on deploy; single Machine only.
- No preview deployments or Web Vitals; use fly logs/Metrics + Playwright.

## Cloudflare Tunnel cutover (2026-11-21, follow-up)

The direct-proxy 525 was worked around with a Cloudflare Tunnel:
- Tunnel "prologue-dev" (id 1f5d6f02-86a9-4873-8781-6a9e9169037c), connectors
  inside both Fly Machines; DNS is apex/www CNAME to the cfargotunnel target,
  proxied. TLS 1.3 only, Full (strict), HTTP/3 + Brotli, IPv6 at the edge.
- Cache rules: static + /static + /og + feeds + SEO text cached (respecting
  origin TTLs), /api bypassed, HTML/RSC and /_next/image origin.
- Verified: /og, /rss, /static, /llms.txt return cf-cache-status HIT after first
  request; HTML DYNAMIC; www 301; TLS 1.2 refused, TLS 1.3 works; AAAA returns
  Cloudflare dual-stack addresses; x-fly-region is nrt from a US vantage and
  sin from Singapore (nearest-connector routing across the two regions).
- Added .github/workflows/monitor.yml (15-min external checks) and
  scripts/docker-entrypoint.sh + cloudflared in the Docker image; TUNNEL_TOKEN
  is a Fly secret. Rolling deploy keeps one connector healthy while the other
  Machine is replaced.

## Edge hardening and monitoring (final)

- Browser Integrity Check disabled and the zone's old "AI Scrapers and
  Crawlers" WAF block removed: with the proxy on, BIC returned 403 to feed
  readers/CI curl, and the WAF rule contradicted the site's robots policy that
  allows retrieval AI agents. Plain curl, Feedly/Inoreader UAs and a GPTBot UA
  now return 200.
- Monitor workflow (15 min, GitHub Actions) passes manually: apex/www/pages/
  feeds/search/OG all 200/301, TLS 1.3 handshake and a Cloudflare cache header.
- Live Playwright smoke through the Cloudflare edge: home/blog/post/ui/
  microblog all 200, correct titles, 0 console errors, 0 broken images;
  theme toggle and the search dialog (API call /api/search?q=AI and rendered
  results) work; www redirects to apex.
