const { withContentlayer } = require("next-contentlayer2");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Contentlayer injects a webpack config; empty turbopack silences Next 16's mismatch error.
  turbopack: {},
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

module.exports = withContentlayer(nextConfig);
