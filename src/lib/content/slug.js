/**
 * The single source of truth for heading anchor ids.
 *
 * The TOC and the rendered headings must agree, and they did not: contentlayer's
 * computed field lowercased the raw heading text and joined spaces, while the
 * DOM ids came from rehype-slug's GitHub slugger. Headings ending in a full
 * width question mark, containing full width parentheses, or with trailing
 * whitespace produced dead anchors -- 15 of 404 across 9 posts.
 *
 * rehype-slug@6 exposes no slugger option (its source reads only `prefix`), so
 * the DOM ids are fixed by construction. This module exists to make the
 * EXTRACTION side produce the same thing, using the same library rehype-slug
 * uses internally.
 *
 * KNOWN LIMIT: rehype-slug slugs a heading's rendered text content, while this
 * reads raw markdown. A heading containing inline code or emphasis would
 * therefore diverge -- `## `foo`` renders as `foo` but reads as `` `foo` ``.
 * No post in this corpus has such a heading (measured: 0 of 404). If one is
 * ever added, this is the function to fix, and scripts/check-slug-parity.mjs is
 * the check that will catch it.
 */
import GithubSlugger from "github-slugger";

/** Slugify one heading the way rehype-slug does. */
export function slugify(text) {
  return new GithubSlugger().slug(String(text ?? ""));
}

/**
 * Extract h2-h6 from raw markdown, in document order, with ids that match the
 * rendered DOM.
 *
 * Walks lines rather than reusing contentlayer.config.js's regex, and tracks
 * fenced code blocks so a `#` inside a fence is not treated as a heading.
 * Verified to produce the same heading COUNT as contentlayer on all 63 posts,
 * and ids equal to the rendered DOM ids on all 404 of them -- including the 9
 * posts where contentlayer's own ids were wrong.
 *
 * A fresh slugger per document, matching rehype-slug's per-tree reset, so
 * duplicate headings get the same -1/-2 suffixes.
 */
export function extractHeadings(markdown) {
  const slugger = new GithubSlugger();
  const headings = [];
  let inFence = false;
  let fenceMarker = "";

  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const m = line.match(/^(#{2,6})\s+(.+?)\s*$/);
    if (!m) continue;
    const text = m[2];
    headings.push({
      level: m[1].length === 2 ? "two" : "three",
      text,
      id: slugger.slug(text),
    });
  }

  return headings;
}
