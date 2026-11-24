import { preload as reactPreload } from "react-dom";
import { IMAGE_VARIANTS } from "../../data/image-variants.js";

/**
 * AVIF-first <picture> replacement for next/image on the fully static site.
 *
 * scripts/build-image-variants.mjs writes, per referenced bitmap:
 *   public/static/variants/<hash>-<width>.avif   (image/avif, q60)
 *   public/static/variants/<hash>-<width>.webp   (image/webp, q80)
 * plus data/image-variants.js. This component turns that manifest into
 *
 *   <picture>
 *     <source type="image/avif" srcset="..." sizes="...">
 *     <source type="image/webp" srcset="..." sizes="...">
 *     <img src="<the authored/optimized original>" ...>
 *   </picture>
 *
 * The <img> fallback is the original URL (SVG, animated GIF and tiny assets
 * that have no variants also land there), so every browser gets valid bytes and
 * the authored file stays available to the lightbox via data-original-src /
 * data-source-src -- exactly the attributes the lightbox controller reads.
 *
 * next/image is not used anywhere any more: a custom loader emits a single
 * <img src> and cannot express AVIF-vs-WebP negotiation, and the static build
 * has no /_next/image endpoint at all.
 */

const DEFAULT_SIZES = "100vw";

function cleanSrc(src) {
	return String(src || "").split("?")[0].split("#")[0];
}

function srcSetFor(entry, format) {
	const map = entry && entry[format];
	if (!map) return "";
	const widths = entry.widths || [];
	const parts = [];
	for (const width of widths) {
		const url = map[String(width)];
		if (url) parts.push(url + " " + width + "w");
	}
	return parts.join(", ");
}

export default function ResponsiveImage({
	src,
	alt = "",
	title,
	width,
	height,
	sizes = DEFAULT_SIZES,
	loading = "lazy",
	fetchPriority,
	decoding,
	className,
	style,
	fill = false,
	unoptimized = false,
	preload = false,
	dataOriginalSrc,
	dataSourceSrc,
	...rest
}) {
	const clean = cleanSrc(src);
	const entry = !unoptimized && clean ? IMAGE_VARIANTS[clean] : null;
	const avifSet = entry ? srcSetFor(entry, "avif") : "";
	const webpSet = entry ? srcSetFor(entry, "webp") : "";

	// A post hero is the LCP candidate. next/image's preload prop used to emit
	// <link rel="preload" imagesrcset=...>; React 19's preload() keeps that
	// behaviour without needing next/image. Guarded because a plain
	// renderToStaticMarkup test cannot service the request-time hoist.
	if (preload) {
		try {
			if (avifSet) {
				reactPreload(clean || src, {
					as: "image",
					type: "image/avif",
					imageSrcSet: avifSet,
					imageSizes: sizes,
					fetchPriority: fetchPriority || "high",
				});
			} else {
				reactPreload(clean || src, { as: "image", fetchPriority: fetchPriority || "high" });
			}
		} catch {
			// preload is an optimisation only; never fail a render for it.
		}
	}

	// The lightbox controller (lightbox-controller.js) picks the viewer's first
	// frame from the LARGEST candidate in the img's own srcset, and falls back to
	// element.src for a below-the-fold lazy image. Keep the WebP family on the
	// <img> as that manifest: <source> elements win for normal rendering, while
	// this preserves the lightbox contract (largest generated thumbnail, not the
	// full original, as the first frame). WebP is used here rather than AVIF so
	// the viewer works in browsers without AVIF support.
	const imgFallbackSrcSet = webpSet || undefined;

	// next/image's fill mode absolutely positioned the img and left sizing to the
	// nearest positioned ancestor (.microblog-media-item). A display:contents
	// wrapper keeps that containing block chain identical while still giving the
	// picture wrapper its two source children.
	const pictureStyle = fill ? { display: "contents" } : undefined;
	const imgStyle = fill
		? {
				position: "absolute",
				inset: 0,
				height: "100%",
				width: "100%",
				color: "transparent",
				...style,
			}
		: style;

	return (
		<picture style={pictureStyle}>
			{avifSet ? <source type="image/avif" srcSet={avifSet} sizes={sizes} /> : null}
			{webpSet ? <source type="image/webp" srcSet={webpSet} sizes={sizes} /> : null}
			<img
				src={src}
				alt={alt}
				title={title || undefined}
				width={fill ? undefined : width}
				height={fill ? undefined : height}
				srcSet={imgFallbackSrcSet}
				sizes={imgFallbackSrcSet ? sizes : undefined}
				loading={loading}
				fetchPriority={fetchPriority}
				decoding={decoding}
				className={className}
				style={imgStyle}
				data-original-src={dataOriginalSrc || undefined}
				data-source-src={dataSourceSrc || undefined}
				{...rest}
			/>
		</picture>
	);
}
