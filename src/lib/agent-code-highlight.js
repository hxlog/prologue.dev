import "server-only";

import { codeToHtml } from "shiki";
import { A2A_CURL, MCP_CONFIG } from "./agent-code";
import { SHIKI_OPTIONS } from "./shiki-config";

let htmlPromise = null;

/**
 * Highlight the two Agent-entry snippets once per build/process. The HTML is
 * emitted with the same Shiki themes and CSS-variable contract as article
 * code, so the panel inherits the article code-block colors in both themes.
 */
export function getAgentCodeHtml() {
  if (!htmlPromise) {
    htmlPromise = Promise.all([
      codeToHtml(MCP_CONFIG, { lang: "json", ...SHIKI_OPTIONS }),
      codeToHtml(A2A_CURL, { lang: "bash", ...SHIKI_OPTIONS }),
    ]).then(([mcpHtml, a2aHtml]) => ({ mcpHtml, a2aHtml }));
  }
  return htmlPromise;
}
