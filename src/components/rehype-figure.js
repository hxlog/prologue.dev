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
		visit(tree, { tagName: "img" }, (node) => {
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
		});
	};
}

function hasOnlyImages({ children }) {
	return children.every((child) => child.tagName === "img" || whitespace(child));
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
			class: ["rounded-lg", "mx-auto", "lightbox-image", "cursor-zoom-in"],
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