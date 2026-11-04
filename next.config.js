/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Cache Components: `use cache` scopes, a prerendered static shell per route,
  // and Partial Prefetching (App Shell prefetched by default, per-link data on
  // `<Link prefetch={true}>`). See src/app/globals.css and the components that
  // read the route for the Suspense boundaries this requires.
  cacheComponents: true,
  partialPrefetching: true,

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
    // Optimized image URLs carry a content hash, so a long edge/browser cache is
    // safe (Next's default is 60s, which re-runs the optimizer on every repeat
    // view of an unchanged file). 31 days.
    minimumCacheTTL: 2678400
  },

  // The OG route reads the author avatar from disk at runtime to inline it in
  // the card. Next's tracer follows imports and static `fs` paths, not a path
  // built from `process.cwd()`, so without this the file is absent from the
  // deployed function and every card would fall back to the initial letter.
  outputFileTracingIncludes: {
    '/og': ['./public/static/favicons/avatar.png'],
  },
};

export default nextConfig;
