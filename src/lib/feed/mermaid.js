/**
 * Feed renderer for Mermaid diagrams.
 *
 * Replaces each <pre class="mermaid"> block with a hosted PNG from mermaid.ink
 * so RSS readers (which strip inline SVG / data URIs) still show the diagram.
 */
import {
  MERMAID_PRE_RE,
  extractMermaidSource,
  encodeMermaidInk,
  altFromMermaidSource,
} from "./mermaid-shared.mjs";

function escapeXmlAttr(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Replace every Mermaid <pre> with a mermaid.ink <img> figure. */
export function transformMermaidDiagrams(html) {
  if (!html || !html.includes("mermaid")) return html;

  const pattern = new RegExp(MERMAID_PRE_RE.source, "gi");
  return html.replace(pattern, (_match, inner) => {
    try {
      const source = extractMermaidSource(inner);
      if (!source) return "";
      const src = encodeMermaidInk(source);
      const alt = escapeXmlAttr(altFromMermaidSource(source));
      return `<figure><img src="${src}" alt="${alt}" width="720" loading="lazy" /></figure>`;
    } catch {
      return "";
    }
  });
}
