/** @type {import('next').NextConfig} */
// Static export target (Cloudflare Workers Static Assets). The Fly/Docker build
// and the published template keep their normal Next behaviour; only the
// Cloudflare export build sets NEXT_EXPORT=1.
const IS_EXPORT = process.env.NEXT_EXPORT === "1";

const nextConfig = {
  reactStrictMode: true,

  // Self-hosting (Docker on Fly.io) needs the traced standalone bundle, while
  // Vercel and local `next start` must keep their normal output. The Docker
  // build sets NEXT_STANDALONE=1; nothing else does.
  output: IS_EXPORT
    ? "export"
    : process.env.NEXT_STANDALONE === "1"
      ? "standalone"
      : undefined,

  // Cache Components: `use cache` scopes, a prerendered static shell per route,
  // and Partial Prefetching (App Shell prefetched by default, per-link data on
  // `<Link prefetch={true}>`). See src/app/globals.css and the components that
  // read the route for the Suspense boundaries this requires.
  // Cache Components (PPR) is removed from this codebase: the site is built as
  // a static export, where PPR cannot be enabled (Next 16 invariant). The
  // published template inherits the same plain-static Next setup.

  // Everything here changes only when a build runs, so caches live from one
  // deploy to the next. Cloudflare is purged by the deploy workflow; the Next
  // data cache uses the same build lifetime instead of the default 30-day
  // `max` profile.
  ...(IS_EXPORT ? { staticPageGenerationTimeout: 180 } : {}),

  // Version-skew protection. Next attaches the deployment id to RSC requests;
  // when a client prefetched from an older deployment navigates after a rollout,
  // the server answers with the right behaviour instead of mixing payloads from
  // two builds (the "Failed to fetch RSC payload" class of error). Vercel injects
  // VERCEL_DEPLOYMENT_ID; Fly passes DEPLOYMENT_ID as a Docker build arg and
  // bakes the same value into the runtime ENV (see Dockerfile). Undefined
  // locally, which disables it.
  deploymentId: IS_EXPORT
    ? undefined
    : process.env.VERCEL_DEPLOYMENT_ID || process.env.DEPLOYMENT_ID || undefined,

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
    // Build-time WebP variants: scripts/build-image-variants.mjs writes the
    // files and data/image-variants.js, and this loader maps next/image widths
    // to those immutable static URLs. No sharp work happens at request time.
    loader: "custom",
    loaderFile: "./src/lib/image-loader.js",
    deviceSizes: [480, 720, 1080, 1440, 1920, 2048],
    // Tiny chrome images fall back to their original static URL when a width
    // has no generated variant.
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },

  // Long-lived browser caching for the immutable, content-hashed derivatives.
  // The un-hashed originals keep a shorter window: replacing one of those in
  // place is the one case where a reader can still hold a stale copy.
  //
  // Order matters on a self-hosted Next server: every matching rule is applied
  // in array order and a later rule overwrites an earlier one (verified: with
  // the specific rule first, /static/opt/* was served with the 7-day generic
  // header). Put the generic rule first and the more specific rule last.
  ...(IS_EXPORT
    ? {}
    : {
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
      {
        source: '/static/variants/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/static/source/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },

  // www -> apex. Canonical URLs are all https://prologue.dev/...; doing this at
  // the origin keeps it working in DNS-only mode and behind Cloudflare alike.
  // On the Cloudflare static target this moves to a zone Single Redirect rule.
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
      }),

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
      './public/static/variants/**',
      './public/static/source/**',
    ],
  },

  // The static export target reads no project file at request time; the OG
  // cards, feeds, llms files and the search index are all generated at build.
  // The remaining trace entry keeps data/projects.yaml available for the
  // Docker/standalone build of the published template.
  outputFileTracingIncludes: {
    '/*': ['./data/projects.yaml'],
  },
};

export default nextConfig;