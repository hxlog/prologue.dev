/**
 * Feed-only HTML normalization helpers.
 *
 * Article pages keep the native MathML and Shiki inline styles. Feed readers
 * and the W3C Feed Validator are a different renderer: the validator flags
 * MathML as a non-HTML tag, rejects CSS custom properties in style attributes,
 * and treats a bare ampersand inside CDATA-hosted HTML as an invalid entity.
 * These transformations therefore run only in buildFeedContent().
 */

/** Escape text for HTML text nodes and quoted attributes. */
export function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Escape ampersands that are not already part of an HTML entity.
 * Valid forms (named or numeric) are preserved, so this must run last.
 */
export function escapeBareAmpersands(html) {
  return String(html || "").replace(
    /&(?!#[0-9]+;|#x[0-9a-f]+;|[a-z][a-z0-9]+;)/gi,
    "&amp;"
  );
}

/** Remove inline style attributes from feed HTML (Shiki, math wrapper, raw HTML). */
export function stripInlineStyles(html) {
  return String(html || "")
    .replace(/\sstyle\s*=\s*"[^"]*"/gi, "")
    .replace(/\sstyle\s*=\s*'[^']*'/gi, "");
}

/**
 * Drop `<span>` wrappers, keeping their contents.
 *
 * Shiki wraps every token in one or two nested spans whose only payload is the
 * (already stripped) colour pair; KaTeX wraps each formula in `span.katex`.
 * Feed readers render none of that highlighting, so the wrappers are pure
 * weight. Only span tags are removed -- `code`, `pre`, `math`, `img`, `a` and
 * every other element (plus its attributes) survive, so structure and text do
 * not change.
 *
 * Both open and close tags are removed unconditionally. That is equivalent to
 * a balanced unwrap for well-formed markup, and it degrades gracefully if an
 * upstream renderer ever emits an unbalanced span: a stray tag is still just
 * dropped rather than leaving a half-unwrapped shell behind.
 */
export function unwrapSpans(html) {
  const source = String(html || "");
  if (!source.includes("<span")) return source;

  const tag = /<\/?span\b[^>]*>/gi;
  let result = "";
  let cursor = 0;
  let match;

  while ((match = tag.exec(source)) !== null) {
    result += source.slice(cursor, match.index);
    cursor = tag.lastIndex;
  }

  return result + source.slice(cursor);
}

/**
 * The markdown pipeline emits a few paragraphs that wrap a <figure> plus text.
 * HTML5 auto-closes the <p> before a block element, and the W3C Feed Validator
 * then reports the closing </p> as an unexpected end tag. Split such paragraphs
 * into a block-level <figure> followed by normal paragraphs; article pages are
 * unaffected because this runs in buildFeedContent() only.
 */
export function fixFigureParagraphs(html) {
  return String(html || "").replace(/<p>([\s\S]*?)<\/p>/g, (match, inner) => {
    if (!/<figure\b/i.test(inner)) return match;

    const parts = [];
    const figure = /<figure\b[\s\S]*?<\/figure>/gi;
    let cursor = 0;
    let block;

    while ((block = figure.exec(inner)) !== null) {
      const before = inner.slice(cursor, block.index).trim();
      if (before) parts.push(`<p>${before}</p>`);
      parts.push(block[0]);
      cursor = block.index + block[0].length;
    }

    const after = inner.slice(cursor).trim();
    if (after) parts.push(`<p>${after}</p>`);
    return parts.join("\n");
  });
}

/** Decode the small HTML entity subset that can appear in MathML annotations. */
function decodeEntities(text) {
  return String(text || "")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_match, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textFallback(mathMarkup) {
  return decodeEntities(String(mathMarkup).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Replace native MathML with readable TeX source.
 *
 * KaTeX emits the original TeX in <annotation encoding="application/x-tex">.
 * The formula itself becomes <code class="math">; the wrapper span around it is
 * removed earlier by unwrapSpans().
 */
export function replaceMathWithFallback(html) {
  return String(html || "").replace(
    /<math\b[^>]*>[\s\S]*?<\/math>/gi,
    (match) => {
      const annotation = match.match(
        /<annotation\b[^>]*\bencoding\s*=\s*["']application\/x-tex["'][^>]*>([\s\S]*?)<\/annotation>/i
      );
      const tex = annotation ? decodeEntities(annotation[1]).trim() : "";
      const fallback = tex || textFallback(match);
      if (!fallback) return "";
      return `<code class="math">${escapeHtml(fallback)}</code>`;
    }
  );
}
