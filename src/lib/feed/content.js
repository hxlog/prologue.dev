import { absolutize, postUrl } from "./urls";
import { transformMermaidDiagrams } from "./mermaid";
import { sanitizeFeedHtml } from "./sanitize";

function escapeAttr(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Lead image for the entry. The cover image is rendered separately on the web
 * page, so it never appears in `body.html`; prepending it here gives readers a
 * hero/thumbnail. Omitted for posts without a real cover (OG title cards add no
 * value as a lead image).
 */
function coverLeadImage(post) {
  const image = String(post.image || "").trim();
  if (!image) return "";
  return `<img src="${absolutize(image)}" alt="${escapeAttr(post.title)}" />`;
}

const KATEX_HTML_MARKER = '<span class="katex-html" aria-hidden="true">';

/**
 * Remove KaTeX's presentation layer (`katex-html`) while keeping the semantic
 * MathML (`katex-mathml`). The presentation spans rely entirely on KaTeX CSS,
 * which feed readers never load, so they render as garbled, duplicated text.
 * MathML renders natively in capable readers and degrades to its text content
 * elsewhere. The span is removed with a balanced-tag scan because it nests.
 */
function stripKatexPresentation(html) {
  if (!html.includes(KATEX_HTML_MARKER)) return html;

  let result = html;
  let index = result.indexOf(KATEX_HTML_MARKER);

  while (index !== -1) {
    const scanner = /<span\b|<\/span>/g;
    scanner.lastIndex = index;
    let depth = 0;
    let end = -1;
    let token;

    while ((token = scanner.exec(result)) !== null) {
      if (token[0] === "</span>") {
        depth -= 1;
        if (depth === 0) {
          end = scanner.lastIndex;
          break;
        }
      } else {
        depth += 1;
      }
    }

    if (end === -1) break;
    result = result.slice(0, index) + result.slice(end);
    index = result.indexOf(KATEX_HTML_MARKER);
  }

  return result;
}

/** Index just past the </span> that closes the span starting at `start`. */
function matchSpanEnd(html, start) {
  const scanner = /<span\b|<\/span>/g;
  scanner.lastIndex = start;
  let depth = 0;
  let token;
  while ((token = scanner.exec(html)) !== null) {
    if (token[0] === "</span>") {
      depth -= 1;
      if (depth === 0) return scanner.lastIndex;
    } else {
      depth += 1;
    }
  }
  return -1;
}

/**
 * Promote block formulas to display math. The malformed upstream markdown
 * pipeline never tags `$$...$$` as display, so KaTeX emits inline MathML for
 * everything. Here we detect a paragraph whose only child is a single KaTeX
 * span (the signature of a block formula), flag its <math> as
 * `display="block"`, and centre it so large equations render as a proper
 * standalone block instead of a cramped inline run.
 */
function markDisplayMath(html) {
  const KATEX_OPEN = '<span class="katex">';
  let result = "";
  let cursor = 0;

  while (cursor < html.length) {
    const pIndex = html.indexOf("<p>", cursor);
    if (pIndex === -1) {
      result += html.slice(cursor);
      break;
    }

    result += html.slice(cursor, pIndex);
    const afterOpen = pIndex + 3;
    const leadingWs = (html.slice(afterOpen).match(/^\s*/) || [""])[0];
    const contentStart = afterOpen + leadingWs.length;

    if (html.startsWith(KATEX_OPEN, contentStart)) {
      const spanEnd = matchSpanEnd(html, contentStart);
      if (spanEnd !== -1) {
        const closer = html.slice(spanEnd).match(/^\s*<\/p>/);
        if (closer) {
          const span = html
            .slice(contentStart, spanEnd)
            .replace(/<math\b(?![^>]*\bdisplay=)/, '<math display="block"');
          result += `<p style="text-align:center;overflow-x:auto">${span}</p>`;
          cursor = spanEnd + closer[0].length;
          continue;
        }
      }
    }

    result += "<p>";
    cursor = afterOpen;
  }

  return result;
}

/** Convert in-page anchors and relative href/src targets to absolute URLs. */
function absolutizeUrls(html, slug) {
  const canonical = postUrl(slug);

  return html
    .replace(/href="#([^"]+)"/gi, (_match, anchor) => `href="${canonical}#${anchor}"`)
    .replace(
      /(href|src)="([^"]*)"/gi,
      (_match, attr, value) => `${attr}="${absolutize(value)}"`
    );
}

/**
 * What used to be here, and why nothing is.
 *
 * `normalizeImages` rebuilt every `<img>` with a fixed attribute list, because
 * rehype-figure once emitted duplicated, comma-joined attributes. That bug is
 * fixed at the source (CLAUDE.md, on HAST `className` being an array) and
 * `check-figure-classes.mjs` asserts it stays fixed. `sanitizeFeedHtml` now does
 * the same job inside a real traversal — `src`, `alt`, `title` and `width` are on
 * the `<img>` allowlist — and unlike a regex it can also refuse a `javascript:`
 * src, which a rebuild could not.
 *
 * `fixVoidTags` normalised `<br>` to `<br />`. `closeSelfClosing` does that and
 * covers `<hr>`, `<img>` and `<input>` at the same time, and it does it in the
 * serializer rather than by rewriting finished markup.
 */

/**
 * Produce reader-ready HTML for a single post:
 *   1. Mermaid diagrams -> mermaid.ink hosted <img> figures.
 *   2. Math -> semantic MathML (presentation layer stripped).
 *   3. All URLs absolutised.
 *   4. Everything sanitised through a real parse/walk/serialize.
 *
 * The ORDER of the last two is not interchangeable. Passes 1–3 ADD structure —
 * a hosted image, a centred display-math paragraph, an absolute URL — and the
 * sanitizer has to see the finished artifact, not an intermediate one, or its
 * allowlist would have to admit shapes that never reach a reader.
 *
 * Pass 4 replaced `normalizeImages` and `fixVoidTags`, which were doing the same
 * two jobs with string surgery and no defence: a regex can rebuild an `<img>` to
 * a known-good shape, but it cannot decide whether an `href` scheme is
 * dangerous, and there is no closed list of bad strings to match against. See
 * src/lib/feed/sanitize.js for the allowlist and where it came from.
 *
 * No site/author footer is appended: that metadata belongs to the feed
 * channel, and repeating it per item is the main source of feed bloat.
 */
export function buildFeedContent(post) {
  let html = post.body.html || "";
  html = transformMermaidDiagrams(html);
  html = stripKatexPresentation(html);
  html = markDisplayMath(html);
  html = absolutizeUrls(html, post.slug);
  html = sanitizeFeedHtml(html);

  const lead = coverLeadImage(post);
  return `${lead}${lead ? "\n" : ""}${html}`.trim();
}
