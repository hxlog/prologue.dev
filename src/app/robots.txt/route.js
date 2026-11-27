import siteMetadata from "../../../data/sitemetadata";

/**
 * robots.txt with Content Signals.
 *
 * Next's MetadataRoute.Robots only models Allow/Disallow groups and a Sitemap;
 * it has no field for Content-Signal. This static route handler keeps the same
 * explicit bot groups and adds the Content Signals directive to every group, so
 * crawlers that match a specific User-Agent block still receive the preference.
 *
 * Content-Signal values (per contentsignals.org / isitagentready):
 *   search=yes   - search indexing and short search excerpts are allowed;
 *   ai-input=yes - allow AI search/RAG indexing, including Cloudflare AI Search;
 *   ai-train=no  - do not train/fine-tune models on the content.
 */
export const dynamic = "force-static";

const CONTENT_SIGNAL = "Content-Signal: search=yes, ai-input=yes, ai-train=no";

const RETRIEVAL_BOTS = [
  "ChatGPT-User",
  "OAI-SearchBot",
  "PerplexityBot",
  "Claude-User",
];

const TRAINING_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "CCBot",
  "Bytespider",
  "Meta-ExternalAgent",
  "cohere-ai",
];

function group(userAgent, rules) {
  return ["User-Agent: " + userAgent, CONTENT_SIGNAL, ...rules].join("\n");
}

export function GET() {
  const groups = [
    group("*", ["Allow: /"]),
    ...RETRIEVAL_BOTS.map((userAgent) => group(userAgent, ["Allow: /"])),
    ...TRAINING_BOTS.map((userAgent) => group(userAgent, ["Disallow: /"])),
  ];
  const body = groups.join("\n\n") + "\n\nSitemap: " + siteMetadata.siteUrl + "/sitemap.xml\n";
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
