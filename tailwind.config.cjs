/**
 * Tailwind v3-style config loaded by Tailwind CSS v4 via `@config` in
 * src/app/globals.css. Only the pieces the v4 CSS-first layer can't express
 * live here: the class-based dark-mode strategy (next-themes) and the
 * @tailwindcss/typography plugin for the `.prose` article body.
 *
 * The actual prose rhythm, accent link colours, and inline-code treatment are
 * overridden in src/app/globals.css: that block also maps the ENTIRE
 * --tw-prose-* family (headings, bold, quotes, captions, table borders) onto
 * the site's semantic tokens. It has to, because typography only swaps its
 * defaults under .prose-invert and this site toggles dark mode with a class on
 * <html> -- leaving the defaults in place is what made every H1/H2 near-black
 * on the dark background. No typography theme extension is needed here.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: ["class"],
  plugins: [require("@tailwindcss/typography")],
};
