import { visit } from "unist-util-visit";
import { whitespace } from "hast-util-whitespace";
import { remove } from "unist-util-remove";
import { h } from "hastscript";
import path from "node:path";
import sharp from "sharp";

/**
 * Post images: figure wrapper, lightbox classes, and REAL intrinsic dimensions.
 *
 * WHY DIMENSIONS ARE READ FROM DISK HERE. The renderer used to give every image
 * width=1920 height=1080. Most screenshots are near 3:2 or 4:3, so the browser
 * reserved a 16:9 box and then reflowed the article when the bitmap arrived --
 * a measured 639x360 -> 639x510 jump mid-scroll, plus a late LCP candidate on
 * the first image. Reading the true size once per file (cached per process)
 * lets the reserved box match the picture.
 *
 * The size lookup needs sharp, which is already a dependency for the OG card.
 * Anything unreadable (remote URL, missing file, exotic format) simply gets no
 * width/height and the browser falls back to its old behaviour -- this is a
 * progressive enhancement, not a build gate.
 */
const sizeCache = new Map();

async function imageSize(src) {
  if (!src || /^(https?:)?\/\//i.test(src)) return null;
  if (sizeCache.has(src)) return sizeCache.get(src);

  let size = null;
  try {
    const clean = decodeURIComponent(src.split("?")[0].split("#")[0]);
    const file = path.join(process.cwd(), "public", clean.replace(/^\//, ""));
    const { width, height } = await sharp(file).metadata();
    if (width > 0 && height > 0) size = { width, height };
  } catch {
    size = null;
  }

  sizeCache.set(src, size);
  return size;
}

export default function rehypeFigure(options = {}) {
	return async (tree) => {
		// unwrap the images inside the paragraph
		visit(tree, { tagName: "p" }, (node, index, parent) => {
			if (!hasOnlyImages(node)) {
				return;
			}

			remove(node, "text");

			parent.children.splice(index, 1, ...node.children);

			return index;
		});

		// wrap images in figure
		visit(tree, (node) => isImageWithAlt(node), (node, index, parent) => {
			if (isImageWithCaption(parent) || isImageLink(parent)) {
				return;
			}

			const figure = createFigure(node, options);

			node.tagName = figure.tagName;
			node.children = figure.children;
			node.properties = figure.properties;
		});

		// Add lightbox attributes to images, and the measured size.
		//
		// className is an ARRAY here: hastscript converts a space-separated
		// `class` string into one. Concatenating a string onto an array
		// stringifies the array with commas, producing a single garbage token
		// like "rounded-lg,mx-auto,lightbox-image,cursor-zoom-in" that matches
		// no CSS -- silently stripping rounded corners and centering from 163
		// images across 36 posts while leaving the lightbox working, so the
		// breakage was invisible.
		//
		// data-lightbox is written through the camelCase key for the same
		// reason: hastscript lowercases `data-*` names into camelCase
		// properties, so setting the literal "data-lightbox" here created a
		// SECOND key alongside the one createFigure already set, and the
		// serialiser emitted `data-lightbox="true" data-lightbox="true"` on
		// all 163 images.
		const images = [];
		visit(tree, { tagName: "img" }, (node) => {
			images.push(node);
		});

		for (let i = 0; i < images.length; i += 1) {
			const node = images[i];
			if (!node.properties) node.properties = {};
			const existing = Array.isArray(node.properties.className)
				? node.properties.className
				: String(node.properties.className || "")
						.split(/\s+/)
						.filter(Boolean);
			node.properties.className = Array.from(
				new Set([...existing, "lightbox-image", "cursor-zoom-in"])
			);
			delete node.properties["data-lightbox"];
			node.properties.dataLightbox = "true";

			const size = await imageSize(node.properties.src);
			if (size) {
				node.properties.width = size.width;
				node.properties.height = size.height;
			}

			// Only the first image is above the fold in practice. It gets to
			// compete for bandwidth with nothing else; everything below stays
			// lazy so a long article does not fetch 12 screenshots at once.
			if (i === 0) {
				node.properties.loading = "eager";
				node.properties.fetchPriority = "high";
			}
		}
	};
}

function hasOnlyImages({ children }) {
	return children.every((child) => child.tagName === "img" || whitespace(child));
}

function isImageWithAlt({ tagName, properties }) {
	return tagName === "img" && Boolean(properties.alt) && Boolean(properties.src);
}

function isImageWithCaption(parent) {
	return Boolean(
		parent &&
			parent.tagName === "figure" &&
			parent.children?.some((child) => child.tagName === "figcaption")
	);
}

function isImageLink(parent) {
	return Boolean(parent && parent.tagName === "a");
}

function createFigure(image) {
	const figure = h("figure", { class: "my-8" }, [
		h("img", {
			...image.properties,
			loading: "lazy",
			decoding: "async",
			class: ["rounded-lg", "mx-auto", "lightbox-image", "cursor-zoom-in"],
			"data-lightbox": "true"
		})
	]);

	if (image.properties.alt) {
		figure.children.push(
			h("figcaption", { class: "text-center text-sm text-muted mt-2" }, [
				image.properties.alt
			])
		);
	}

	return figure;
}
