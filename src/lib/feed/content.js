import { absolutize, coverImageUrl, postUrl } from "./urls";
import {
  escapeBareAmpersands,
  fixFigureParagraphs,
  replaceMathWithFallback,
  stripInlineStyles,
  unwrapSpans,
} from "./html";
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
 * hero/thumbnail. Posts without a local cover use the same /og fallback as the
 * JSON Feed and Open Graph metadata, so every entry has a visible image.
 */
function coverLeadImage(post) {
  return `<img src="${escapeAttr(coverImageUrl(post))}" alt="${escapeAttr(post.title)}" />`;
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
          result += `<p class="math-display">${span}</p>`;
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
 *   2. Inline styles removed and MathML replaced by TeX <code> fallbacks.
 *   3. All URLs absolutised, images cleaned, void tags normalised.
 *
 * The article page keeps native MathML and Shiki styles; those are only
 * downgraded here because the W3C Feed Validator's HTML parser rejects MathML
 * and CSS custom properties inside feed content.
 *
 * No site/author footer is appended: that metadata belongs to the feed
 * channel, and repeating it per item is the main source of feed bloat.
 */
export function buildFeedContent(post) {
  let html = post.body.html || "";
  html = transformMermaidDiagrams(html);
  html = markDisplayMath(html);
  html = stripInlineStyles(html);
  html = unwrapSpans(html);
  html = replaceMathWithFallback(html);
  html = absolutizeUrls(html, post.slug);
  html = normalizeImages(html);
  html = fixFigureParagraphs(html);
  html = fixVoidTags(html);

  const lead = coverLeadImage(post);
  return escapeBareAmpersands(`${lead}${lead ? "\n" : ""}${html}`).trim();
}
