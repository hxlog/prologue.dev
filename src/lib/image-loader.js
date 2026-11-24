import { IMAGE_VARIANTS } from "../../data/image-variants.js";

/**
 * next/image custom loader for build-time variants.
 *
 * The static site no longer renders next/image: <ResponsiveImage> emits an
 * AVIF-first <picture> from the same manifest (data/image-variants.js). This
 * loader is kept as a compatibility shim for any next/image call site that is
 * reintroduced later; it serves the WebP family, because a single <img src>
 * cannot negotiate AVIF vs WebP.
 *
 * Anything not in the manifest (SVG, animated GIF, tiny favicons) falls back to
 * its original static URL.
 */
export default function contentImageLoader({ src, width }) {
	const clean = src.split("?")[0].split("#")[0];
	const entry = IMAGE_VARIANTS[clean];
	if (!entry) return src;
	const widths = Array.isArray(entry.widths) ? entry.widths : [];
	if (!widths.length) return src;
	const target = widths.find((candidate) => candidate >= width) || widths[widths.length - 1];
	const webp = entry.webp && entry.webp[String(target)];
	if (webp) return webp;
	// Pre-manifest-extension shape (hash + widths only).
	const hash = entry.hash || entry.h;
	if (hash) return "/static/variants/" + hash + "-" + target + ".webp";
	return src;
}
