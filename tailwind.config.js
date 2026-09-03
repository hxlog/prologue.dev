/**
 * Tailwind v3-style config loaded by Tailwind CSS v4 via `@config` in
 * src/app/globals.css. Only the pieces the v4 CSS-first layer can't express
 * live here: the class-based dark-mode strategy (next-themes) and the
 * @tailwindcss/typography plugin for the `.prose` article body.
 *
 * The actual prose rhythm, accent link colors, and inline-code treatment are
 * overridden in src/app/globals.css (CJK-friendly 1.85 line-height, cyan
 * links, violet inline code), so no typography theme extension is needed here.
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
