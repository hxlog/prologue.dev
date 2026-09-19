/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Cache Components. This is the switch that makes `'use cache'`,
  // `cacheLife()` and `cacheTag()` real; without it the directives are parsed
  // and silently ignored, so pages look cached and re-query on every request.
  //
  // It also changes what is legal: `export const dynamic` and `dynamicParams`
  // become build errors (the reading is "say what you want to cache, rather
  // than opting the whole route out"), and so does touching a non-deterministic
  // value — `new Date()`, `Math.random()` — outside a `'use cache'` boundary,
  // because its output would differ between builds with no input having
  // changed. Both constraints are enforced by the build, which is why the flag
  // went on in the same commit as the caching tags rather than before them.
  cacheComponents: true,

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
  },

  async redirects() {
    return [
      // Numbered archive pagination was replaced by load-more.
      { source: '/blog/page/:page*', destination: '/blog', permanent: true },
      // Tag taxonomy merge: Web3 folded into Crypto (kept for old traffic).
      { source: '/tags/Web3', destination: '/tags/Crypto', permanent: true },
    ];
  },
};

module.exports = nextConfig;
