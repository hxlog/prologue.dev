/** @type {import('next').NextConfig} */
// Static-export target (Cloudflare Workers Static Assets). The published
// template and local development keep their normal Next behaviour; only the
// Cloudflare export build sets NEXT_EXPORT=1.
const IS_EXPORT = process.env.NEXT_EXPORT === "1";

const nextConfig = {
  reactStrictMode: true,

  output: IS_EXPORT ? "export" : undefined,

  // A full static export renders every route once at build time. Some routes
  // are large (Shiki-highlighted posts), so give the build a generous budget.
  ...(IS_EXPORT ? { staticPageGenerationTimeout: 180 } : {}),

  // Client router cache. Content is immutable per deployment, but a tab that
  // stays open across a deploy can otherwise navigate with RSC payloads that
  // reference the previous build's chunks. 60s keeps prefetch useful inside a
  // reading session while bounding that cross-deploy window; the version guard
  // (src/components/version-guard.js) hard-reloads a stale tab on refocus.
  // Dynamic routes are not prefetched here (they have no loading.js), so their
  // scrollback/cache behaviour stays at the default.
  experimental: {
    staleTimes: { static: 60 },
    ...(process.env.EXPOSE_TESTING_API === "1"
      ? { exposeTestingApiInProductionBuild: true }
      : {}),
  },

  // The static export serves images from build-time AVIF/WebP variants via
  // <ResponsiveImage>, not next/image, so the custom image loader and its
  // config are gone. next/image with the default loader is not supported by
  // output: "export" anyway.

  // Content images are served straight from the CDN and are only ever named in
  // markdown/JS data — nothing reads them from the function filesystem. Keeping
  // them out of the traces removes ~27 MB from a normal Next build (template /
  // Vercel path).
  outputFileTracingExcludes: {
    "/*": [
      "./public/static/images/**",
      "./public/static/photos/**",
      "./public/static/opt/**",
      "./public/static/variants/**",
      "./public/static/source/**",
    ],
  },

  // The static export reads no project file at request time; the OG cards,
  // feeds, llms files and the search index are all generated at build. The
  // remaining trace entry keeps data/projects.yaml available for the normal
  // Next build of the published template.
  outputFileTracingIncludes: {
    "/*": ["./data/projects.yaml"],
  },
};

export default nextConfig;
