# Deploy: Vercel

This repo and the published template both deploy to Vercel with the **native Next.js build** — no static-export flag needed. Vercel is the equivalent alternative to the production Cloudflare Worker; features, SEO, OG cards and feeds are identical.

## One-click

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhxlog%2Fprologue-blog-template)

The button clones the template repository. To deploy **this** repository instead, import it in the Vercel dashboard.

## Manual import

1. Vercel → **Add New Project** → import the repo.
2. Framework preset: **Next.js** (auto-detected).
3. Build command: `yarn build` · Install command: `yarn install` · Output: default (`.next`).
4. Node.js version: **24.x** (matches `engines.node`).
5. Deploy.

## What the build does

`yarn build` runs the same pipeline as the Cloudflare export, minus the static-export step:

```text
build-search-index.mjs   → search corpus + image sizes + route manifest
build-image-variants.mjs → AVIF/WebP responsive variants in public/static/variants
build-og-images.mjs      → 70 static OG cards in public/og
next build               → HTML/RSC, feeds, sitemap, robots, llms
```

Because `public/og` is generated before `next build`, metadata and feeds point at existing cards. Images are served from `public/static/variants` by the custom image loader.

## Route behavior

- `www` → apex is **not** handled by the app; configure the redirect in Vercel → Domains.
- There is no `headers()`/`redirects()` in `next.config.js`: caching headers belong to the platform (Vercel defaults + immutable hashed assets).
- The optional Cloudflare-only files (`wrangler.jsonc`, `scripts/build-cf-assets.mjs`) are ignored by Vercel.

## Differences from the Cloudflare production target

| | Cloudflare (production) | Vercel |
|---|---|---|
| Output | `output: "export"` → `out/` assets | Native Next build |
| Runtime | assets-only Worker, no server code | Vercel serverless/edge (pages are static) |
| Cache | Worker deployment version + `out/_headers` | Vercel CDN defaults |
| Cost | $0 on Free plan | Free Hobby plan |

## Troubleshooting

- **OG images 404** → the build command must include `build-og-images.mjs` (it does in `package.json`); do not override it with bare `next build`.
- **Images 404** → `yarn build` must run `build-image-variants.mjs` first (same reason).
- **Yarn version errors** → keep `corepack enable` / the pinned `packageManager`; Vercel reads `engines.node`.