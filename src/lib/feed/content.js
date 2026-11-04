import { absolutize, postUrl } from "./urls";
import { transformMermaidDiagrams } from "./mermaid";

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
 * Rebuild <img> tags with only the attributes feed readers need.
 * Contentlayer/rehype-figure emit duplicated and comma-joined attributes
 * (e.g. two data-lightbox attributes) that are invalid HTML.
 */
function normalizeImages(html) {
  return html.replace(/<img\b([^>]*?)\/?>/gi, (match, attrs) => {
    const src = (attrs.match(/\bsrc="([^"]*)"/i) || [])[1];
    if (!src) return "";

    const alt = (attrs.match(/\balt="([^"]*)"/i) || [])[1] || "";
    const title = (attrs.match(/\btitle="([^"]*)"/i) || [])[1];
    const width = (attrs.match(/\bwidth="([^"]*)"/i) || [])[1];

    let tag = `<img src="${src}" alt="${alt}"`;
    if (title) tag += ` title="${title}"`;
    if (width) tag += ` width="${width}"`;
    tag += " />";
    return tag;
  });
}

/** Normalise void elements so the emitted HTML stays well-formed. */
function fixVoidTags(html) {
  return html
    .replace(/<\/br>/gi, "")
    .replace(/<br\s*\/?>/gi, "<br />")
    .replace(/<hr\s*\/?>/gi, "<hr />");
}

/**
 * Produce reader-ready HTML for a single post:
 *   1. Mermaid diagrams -> mermaid.ink hosted <img> figures.
 *   2. Math -> semantic MathML (presentation layer stripped).
 *   3. All URLs absolutised, images cleaned, void tags normalised.
 *
 * No site/author footer is appended: that metadata belongs to the feed
 * channel, and repeating it per item is the main source of feed bloat.
 */
export function buildFeedContent(post) {
  let html = post.body.html || "";
  html = transformMermaidDiagrams(html);
  // KaTeX no longer emits an HTML presentation layer (the pipeline renders
  // MathML directly), so there is nothing to strip: the only thing feeds need
  // is the block-vs-inline promotion below, which keys on the `katex` wrapper.
  html = markDisplayMath(html);
  html = absolutizeUrls(html, post.slug);
  html = normalizeImages(html);
  html = fixVoidTags(html);

  const lead = coverLeadImage(post);
  return `${lead}${lead ? "\n" : ""}${html}`.trim();
}
