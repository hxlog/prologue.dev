import siteMetadata from "../../data/sitemetadata";

/**
 * Search engines and retrieval-oriented AI agents may index the site; training
 * crawlers are separate user-agent groups and are asked not to train on it.
 * Keeping the groups explicit is clearer than relying on wildcard inheritance.
 */
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

export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
      ...RETRIEVAL_BOTS.map((userAgent) => ({ userAgent, allow: "/" })),
      ...TRAINING_BOTS.map((userAgent) => ({ userAgent, disallow: "/" })),
    ],
    sitemap: siteMetadata.siteUrl + "/sitemap.xml",
  };
}
