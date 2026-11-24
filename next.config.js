/** @type {import('next').NextConfig} */
// Static export target (Cloudflare Workers Static Assets). The published
// template and local development keep their normal Next behaviour; only the
// Cloudflare export build sets NEXT_EXPORT=1.
const IS_EXPORT = process.env.NEXT_EXPORT === "1";

const nextConfig = {
  reactStrictMode: true,

  output: IS_EXPORT ? "export" : undefined,

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
  // normal Next build of the published template.
  outputFileTracingIncludes: {
    '/*': ['./data/projects.yaml'],
  },
};

export default nextConfig;