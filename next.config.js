/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Self-hosting (Docker on Fly.io) needs the traced standalone bundle, while
  // Vercel and local `next start` must keep their normal output. The Docker
  // build sets NEXT_STANDALONE=1; nothing else does.
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,

  // Cache Components: `use cache` scopes, a prerendered static shell per route,
  // and Partial Prefetching (App Shell prefetched by default, per-link data on
  // `<Link prefetch={true}>`). See src/app/globals.css and the components that
  // read the route for the Suspense boundaries this requires.
  cacheComponents: true,
  partialPrefetching: true,

  // Version-skew protection. Next attaches the deployment id to RSC requests;
  // when a client prefetched from an older deployment navigates after a rollout,
  // the server answers with the right behaviour instead of mixing payloads from
  // two builds (the "Failed to fetch RSC payload" class of error). Vercel injects
  // VERCEL_DEPLOYMENT_ID; Fly passes DEPLOYMENT_ID as a Docker build arg and
  // bakes the same value into the runtime ENV (see Dockerfile). Undefined
  // locally, which disables it.
  deploymentId:
    process.env.VERCEL_DEPLOYMENT_ID || process.env.DEPLOYMENT_ID || undefined,

  // 15-minute client router cache. Every card here is `prefetch={true}`, so the
  // 5-minute default makes a long reading session re-fetch the same prefetched
  // RSC payloads from the server every five minutes. Content only changes on
  // deploy, and `deploymentId` scopes the router cache to one build, so a longer
  // window cannot mix two builds.
  //
  // The instant-navigation testing API is enabled only for the e2e build; a
  // normal `yarn build` omits that key entirely instead of serialising it false.
  experimental: {
    staleTimes: { static: 900 },
    ...(process.env.EXPOSE_TESTING_API === "1"
      ? { exposeTestingApiInProductionBuild: true }
      : {}),
  },

  images: {
    formats: ["image/avif", "image/webp"],
    unoptimized: false,
    path: '/_next/image',
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // Native fix for images opening as downloads: Next's optimizer defaults to
    // Content-Disposition: attachment on every /_next/image response (a
    // content-injection safeguard); 'inline' makes direct opens/lightbox views
    // display in the browser. This replaces the previous triple workaround
    // (middleware.js + vercel.json + headers() overrides).
    contentDispositionType: 'inline',
    // Storyfile URLs are *not* content-hashed by Next — the query string only
    // carries url/w/q. A long TTL is therefore only safe because every image this
    // site serves is either named with a content hash (public/static/opt/**) or
    // is a build asset that changes with the deploy. Replacing an image means
    // replacing its URL; see docs/CONTENT.md.
    minimumCacheTTL: 2678400,
    // Self-hosted machines write optimized images to .next/cache/images. Cap the
    // LRU at 128 MiB: a 256 MB Fly Machine has a small rootfs and the default
    // (50% of free disk) can grow enough to fill it.
    maximumDiskCacheSize: 134217728
  },

  // Long-lived browser caching for the immutable, content-hashed derivatives.
  // The un-hashed originals keep a shorter window: replacing one of those in
  // place is the one case where a reader can still hold a stale copy.
  //
  // Order matters on a self-hosted Next server: every matching rule is applied
  // in array order and a later rule overwrites an earlier one (verified: with
  // the specific rule first, /static/opt/* was served with the 7-day generic
  // header). Put the generic rule first and the more specific rule last.
  async headers() {
    return [
      {
        source: '/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=604800, stale-while-revalidate=2592000',
          },
        ],
      },
      {
        source: '/static/opt/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },

  // www -> apex. Canonical URLs are all https://prologue.dev/...; doing this at
  // the origin keeps it working in DNS-only mode and behind Cloudflare alike.
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.prologue.dev' }],
        destination: 'https://prologue.dev/:path*',
        // 301 (permanent: true would emit 308; legacy links and SEO expect 301).
        statusCode: 301,
      },
    ];
  },

  // Content images are served straight from the CDN and are only ever named in
  // markdown/JS data — nothing reads them from the function filesystem any more
  // (the markdown pipeline and the feeds resolve through data/image-sizes.js).
  // Keeping them out of the traces removes ~27 MB from every serverless bundle;
  // favicons/ and avatars/ stay traced because /og and the site metadata read them.
  outputFileTracingExcludes: {
    '/*': [
      './public/static/images/**',
      './public/static/photos/**',
      './public/static/opt/**',
    ],
  },

  // The OG route reads the author avatar from disk at runtime to inline it in
  // the card. Next's tracer follows imports and static `fs` paths, not a path
  // built from `process.cwd()`, so without this the file is absent from the
  // deployed function and every card would fall back to the initial letter.
  outputFileTracingIncludes: {
    // The OG card reads its subset fonts, glyph table and pre-scaled avatar from
    // assets/og/ with a runtime-computed path, so the tracer cannot follow it.
    '/og': ['./assets/og/**', './public/static/favicons/avatar.png'],
    // /api/search reads the generated corpus from disk on first request. It is
    // built by scripts/build-search-index.mjs, which the tracer cannot see
    // through, so the file must be included explicitly or the deployed function
    // answers 503 index-unavailable.
    '/api/search': ['./public/search-index.json'],
    // The /about portfolio reads data/projects.yaml inside a 'use cache' scope.
    // If that cache revalidates in a deployment, the file has to be present in
    // the server trace; a catch-all key keeps the one small file available.
    '/*': ['./data/projects.yaml'],
  },
};

export default nextConfig;
