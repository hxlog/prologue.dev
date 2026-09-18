import { visit } from "unist-util-visit";
import { whitespace } from "hast-util-whitespace";
import { remove } from "unist-util-remove";
import { h } from "hastscript";

export default function rehypeFigure(options = {}) {
	return (tree) => {
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
			// `parent` is undefined for a node at the root, which cannot come
			// out of markdown but would crash the two guards below on
			// destructuring. An image with nothing around it is already its own
			// figure, so leave it alone.
			if (!parent) {
				return;
			}
			if (isImageWithCaption(parent) || isImageLink(parent)) {
				return;
			}

			const figure = createFigure(node, options);

			node.tagName = figure.tagName;
			node.children = figure.children;
			node.properties = figure.properties;
		});

		// Add lightbox attributes to images.
		//
		// Classes are handled as a Set, not by string concatenation. HAST does
		// not store `className` as a string: `hastscript`, and the markdown
		// pipeline itself, store it as an ARRAY of class names. Appending with
		// `(existing || "") + " foo"` therefore coerces the array with
		// Array#toString — which joins on commas — and the class attribute
		// rendered as `class="rounded-lg,mx-auto,lightbox-image"`: one class
		// name that matches nothing. This affected 163 of 179 images, and it
		// silently defeated the lightbox's `img.lightbox-image` lookup on every
		// image that had any class of its own.
		visit(tree, { tagName: "img" }, (node) => {
			if (!node.properties) node.properties = {};

			const classes = new Set(toClassList(node.properties.className));
			classes.add("lightbox-image");
			classes.add("cursor-zoom-in");
			node.properties.className = [...classes];
			node.properties["data-lightbox"] = "true";
		});
	};
}

/**
 * HAST's `className` is an array per the spec, but every producer in this
 * pipeline is loose about it — hastscript emits arrays, hand-written plugins
 * sometimes emit strings, and a malformed one can emit a number. Normalise all
 * of them to a flat list of non-empty names.
 */
function toClassList(value) {
	const raw = Array.isArray(value) ? value : value ? [value] : [];
	return raw
		.flatMap((entry) => String(entry).split(/\s+/))
		.map((name) => name.trim())
		.filter(Boolean);
}

function hasOnlyImages({ children }) {
	return children.length > 0 && children.every((child) => child.tagName === "img" || whitespace(child));
}

function isImageWithAlt({ tagName, properties }) {
	return tagName === "img" && Boolean(properties.alt) && Boolean(properties.src);
}

function isImageWithCaption({ tagName, children }) {
	return tagName === "figure" && children.some((child) => child.tagName === "figcaption");
}

function isImageLink({ tagName }) {
	return tagName === "a";
}

function createFigure(image) {
	const figure = h("figure", { class: "my-8" }, [
		h("img", {
			...image.properties,
			loading: "lazy",
			decoding: "async",
			class: "rounded-lg mx-auto lightbox-image cursor-zoom-in",
			"data-lightbox": "true"
		})
	]);

	if (image.properties.alt) {
		figure.children.push(
			h("figcaption", { class: "text-center text-sm text-gray-600 dark:text-gray-400 mt-2" }, [
				image.properties.alt
			])
		);
	}

	return figure;
}