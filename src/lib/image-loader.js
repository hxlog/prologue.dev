import { IMAGE_VARIANTS } from "../../data/image-variants.js";

/**
 * next/image custom loader for build-time WebP variants.
 *
 * scripts/build-image-variants.mjs writes public/static/variants/<hash>-<width>.webp
 * and data/image-variants.js. The filename hash is the source content hash, so a
 * changed image gets a new immutable URL. Anything not in the manifest (SVG,
 * animated GIF, tiny favicons that cannot be resized) falls back to its original
 * static URL; the browser still gets valid bytes, and next/image keeps the
 * width/height layout.
 */
export default function contentImageLoader({ src, width }) {
  const clean = src.split("?")[0].split("#")[0];
  const entry = IMAGE_VARIANTS[clean];
  if (!entry || !entry.h || !Array.isArray(entry.widths) || entry.widths.length === 0) {
    return src;
  }
  const sizes = entry.widths;
  const target = sizes.find((candidate) => candidate >= width) || sizes[sizes.length - 1];
  return "/static/variants/" + entry.h + "-" + target + ".webp";
}