#!/usr/bin/env node
/**
 * Generate the RFC 9727 API catalog and its discovery documents into public/.
 *
 * The site has no origin server: the public "API" is the set of read-only,
 * machine-readable content surfaces (RSS/Atom/JSON feeds, search corpora,
 * sitemap, llms files, version). Keeping them in one OpenAPI description makes
 * the catalog entry useful to an agent instead of a bare link.
 *
 * Runs before next build / next dev in dev, build and export so it works for
 * both Cloudflare and Vercel. Outputs:
 *   public/.well-known/api-catalog
 *   public/.well-known/openapi.json
 *   public/.well-known/api-doc.md
 *
 * Content types and cache policy are set by scripts/build-cf-assets.mjs for
 * Cloudflare; Vercel inherits MIME by extension.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import siteMetadata from "../data/sitemetadata.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");
const OUT_DIR = path.join(PUBLIC_DIR, ".well-known");
const BASE = String(siteMetadata.siteUrl || "").replace(/\/+$/, "");

const PATHS = {
  "/rss": { summary: "RSS 2.0 feed", description: "Full-text RSS 2.0 feed for all published posts.", mediaType: "application/rss+xml" },
  "/atomfeed": { summary: "Atom 1.0 feed", description: "Full-text Atom 1.0 feed for all published posts.", mediaType: "application/atom+xml" },
  "/jsonfeed": { summary: "JSON Feed 1.1", description: "Full-text JSON Feed 1.1 document for all published posts.", mediaType: "application/feed+json" },
  "/microblog/rss": { summary: "Microblog RSS 2.0 feed", description: "RSS 2.0 feed for the microblog timeline.", mediaType: "application/rss+xml" },
  "/search-index.json": { summary: "Full-text search corpus", description: "Static JSON corpus used by the browser search dialog.", mediaType: "application/json" },
  "/search-index-lite.json": { summary: "Lite search corpus", description: "Smaller static JSON search corpus loaded first by the browser.", mediaType: "application/json" },
  "/sitemap.xml": { summary: "XML sitemap", description: "All indexable HTML routes and their last-modified dates.", mediaType: "application/xml" },
  "/llms.txt": { summary: "LLM site index", description: "Short llms.txt index of the site content.", mediaType: "text/plain" },
  "/llms-full.txt": { summary: "Full LLM corpus", description: "Full-text llms-full.txt corpus of published content.", mediaType: "text/plain" },
  "/version.json": { summary: "Deployment version", description: "Current deployment version used by the client version guard.", mediaType: "application/json" },
};

function openApi() {
  const paths = {};
  for (const [route, meta] of Object.entries(PATHS)) {
    const operationId = "get" + route.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^get/, "");
    paths[route] = {
      get: {
        summary: meta.summary,
        description: meta.description,
        operationId,
        responses: {
          200: {
            description: meta.summary,
            content: { [meta.mediaType]: { schema: { type: "string" } } },
          },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Prologue content API",
      version: "1.0.0",
      description: "Read-only, unauthenticated machine surfaces of prologue.dev: feeds, search corpora, sitemap, llms files and deployment version. HTML pages remain the default browser representation; send Accept: text/markdown for the Markdown variant of HTML routes.",
      license: { name: siteMetadata.copyright || "All rights reserved", url: siteMetadata.copyrightUrl || BASE },
    },
    servers: [{ url: BASE }],
    security: [],
    paths,
  };
}

const catalog = {
  linkset: [
    {
      anchor: BASE,
      "service-desc": [{ href: BASE + "/.well-known/openapi.json", type: "application/vnd.oai.openapi+json;version=3.1" }],
      "service-doc": [{ href: BASE + "/.well-known/api-doc.md", type: "text/markdown" }],
      status: [{ href: BASE + "/version.json", type: "application/json" }],
    },
  ],
};

function apiDoc() {
  const lines = [
    "# Prologue content API",
    "",
    "Read-only, unauthenticated machine surfaces of " + BASE + ".",
    "",
    "HTML pages are the default browser representation. Send Accept: text/markdown",
    "on an HTML route to receive the Markdown variant.",
    "",
    "Base URL: " + BASE,
    "",
    "## Endpoints",
    "",
  ];
  for (const [route, meta] of Object.entries(PATHS)) {
    lines.push("- GET " + route + " - " + meta.description + " (" + meta.mediaType + ")");
  }
  lines.push(
    "",
    "## Discovery",
    "",
    "- API catalog: " + BASE + "/.well-known/api-catalog",
    "- OpenAPI 3.1: " + BASE + "/.well-known/openapi.json",
    "- Version / health: " + BASE + "/version.json",
    "",
    "## Policy",
    "",
    "No authentication, no write operations, no request-time rate limits beyond",
    "Cloudflare normal edge protections. Content is licensed under " + (siteMetadata.copyright || "the site license") + ".",
    "",
  );
  return lines.join("\n");
}

const AGENT_CREDENTIAL_TYPE = "urn:prologue:anonymous-agent-credential";
const AGENT_SCOPES = ["content:read"];
const AGENT_AUTH = {
  skill: BASE + "/auth.md",
  register_uri: BASE + "/agent/auth",
  identity_types_supported: ["anonymous"],
  anonymous: {
    credential_types_supported: [AGENT_CREDENTIAL_TYPE],
    claim_uri: BASE + "/agent/claim",
  },
  claim_uri: BASE + "/agent/claim",
  revocation_uri: BASE + "/agent/revoke",
};

function protectedResourceDoc() {
  return {
    resource: BASE,
    authorization_servers: [BASE],
    scopes_supported: AGENT_SCOPES,
    bearer_methods_supported: ["header"],
    resource_documentation: BASE + "/auth.md",
  };
}

function authorizationServerDoc() {
  return {
    issuer: BASE,
    authorization_endpoint: BASE + "/agent/authorize",
    token_endpoint: BASE + "/agent/token",
    registration_endpoint: BASE + "/agent/auth",
    revocation_endpoint: BASE + "/agent/revoke",
    scopes_supported: AGENT_SCOPES,
    response_types_supported: ["token"],
    grant_types_supported: ["client_credentials"],
    token_endpoint_auth_methods_supported: ["none"],
    service_documentation: BASE + "/auth.md",
    agent_auth: AGENT_AUTH,
  };
}

const WEBBOT_JWK = {
  kty: "OKP",
  crv: "Ed25519",
  x: "Kl1jYRrmzreg3FqwngTEqUMJfbIwV058ua1wWVRhAFw",
  kid: "vyK6J_DVVaRScR0feW1ITPni_THWs9sG1qzHWjZICrk",
  use: "sig",
  alg: "Ed25519",
};

function webBotAuthDirectory() {
  return { keys: [WEBBOT_JWK] };
}

function mcpCardDoc() {
  return {
    "$schema": "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    name: "dev.prologue/content-agent",
    title: "Prologue MCP Content Server",
    version: "1.0.0",
    description: "Read-only MCP server for discovering and reading prologue.dev content and machine-readable surfaces.",
    serverInfo: {
      name: "Prologue MCP Content Server",
      version: "1.0.0",
    },
    transport: {
      type: "streamable-http",
      endpoint: BASE + "/mcp",
      url: BASE + "/mcp",
    },
    transports: [
      {
        type: "streamable-http",
        endpoint: BASE + "/mcp",
      },
    ],
    remotes: [
      {
        type: "streamable-http",
        url: BASE + "/mcp",
        supportedProtocolVersions: ["2025-06-18"],
      },
    ],
    capabilities: {
      tools: true,
      resources: true,
      prompts: false,
    },
    documentationUrl: BASE + "/auth.md",
    iconUrl: BASE + "/static/favicons/avatar.png",
  };
}

function agentCardDoc() {
  return {
    name: "Prologue Content Agent",
    version: "1.0.0",
    description: "Read-only A2A agent for discovering and reading the public content of prologue.dev. It returns links to posts, feeds, search corpora and Markdown representations; it does not write data or expose private content.",
    provider: {
      organization: siteMetadata.siteName || "Prologue",
      url: BASE,
    },
    documentationUrl: BASE + "/.well-known/api-doc.md",
    iconUrl: BASE + "/static/favicons/avatar.png",
    supportedInterfaces: [
      {
        url: BASE + "/a2a",
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain", "text/markdown"],
    skills: [
      {
        id: "content-discovery",
        name: "Prologue content discovery",
        description: "Find the site's public articles, feeds, search corpora and machine-readable discovery documents.",
        tags: ["content", "search", "rss", "openapi", "markdown"],
        examples: [
          "What machine-readable surfaces does prologue.dev expose?",
          "Where is the search corpus or RSS feed?",
        ],
      },
      {
        id: "markdown-retrieval",
        name: "Markdown page retrieval",
        description: "Return a link to the Markdown representation of any public HTML route on prologue.dev.",
        tags: ["markdown", "content-negotiation"],
        examples: [
          "Give me the Markdown version of the about page.",
          "Fetch the latest post as Markdown.",
        ],
      },
    ],
  };
}

function authDoc() {
  const issues = siteMetadata.github
    ? "https://github.com/" + siteMetadata.github + "/" + (siteMetadata.siteRepo || "issues") + "/issues"
    : BASE;
  return [
    "# Prologue.dev auth.md",
    "",
    "Agent registration and authentication discovery for " + BASE + ".",
    "",
    "This service accepts AI agent registrations for anonymous, read-only access to its public content.",
    "",
    "## Audience",
    "",
    "AI agents, crawlers and automated clients that want to read the public content and machine-readable surfaces of this site. There is no human account system and no agent-specific account tier.",
    "",
    "## Registration or provisioning",
    "",
    "Anonymous agent registration is available at " + BASE + "/agent/auth. It creates no human account, sends no email and requires no payment or invitation.",
    "",
    "- Registration endpoint: POST " + BASE + "/agent/auth (JSON body optional).",
    "- Registration returns an ephemeral anonymous bearer credential; no account or persistent identity is created.",
    "- OAuth Protected Resource Metadata: " + BASE + "/.well-known/oauth-protected-resource",
    "- OAuth Authorization Server metadata: " + BASE + "/.well-known/oauth-authorization-server",
    "",
    "## Supported authentication methods",
    "",
    "- Anonymous registration (identity_types_supported: [\"anonymous\"]). No ID-JAG, verified-email, API key, mTLS or client-secret registration is offered.",
    "- The public content endpoints do not require any credential; anonymous registration exists so an agent can obtain an explicit ephemeral bearer credential.",
    "- Do not attempt browser/OIDC flows. The Authorization Server advertises the anonymous method only.",
    "",
    "## Claim and revocation",
    "",
    "- No human claim ceremony is required. GET " + BASE + "/agent/claim returns not_required.",
    "- POST " + BASE + "/agent/revoke revokes an ephemeral credential; the server keeps no credential records.",
    "",
    "## Credential use",
    "",
    "- If an agent registers, it may store the returned token and send it as `Authorization: Bearer <token>` when it wants an explicit anonymous identity. The public content endpoints do not require or validate it.",
    "- Do not create human accounts, store passwords, send email or attempt credential escalation. There is no protected resource that requires the token.",
    "- Respect robots.txt, the Content-Signal response header and Cloudflare edge protections; those are the applicable usage policy.",
    "",
    "## Machine-readable entry points",
    "",
    "- API catalog: " + BASE + "/.well-known/api-catalog",
    "- OpenAPI 3.1: " + BASE + "/.well-known/openapi.json",
    "- Markdown for Agents: send Accept: text/markdown to any HTML route",
    "- Site docs for agents: " + BASE + "/llms.txt",
    "- Feeds: " + BASE + "/rss, " + BASE + "/atomfeed, " + BASE + "/jsonfeed",
    "- Version / health: " + BASE + "/version.json",
    "",
    "## Agent auth metadata",
    "",
    "```json",
    JSON.stringify({ agent_auth: AGENT_AUTH }, null, 2),
    "```",
    "",
    "## Rate limits and policy",
    "",
    "The site is served by Cloudflare Workers Static Assets. Normal edge protections apply; there is no application-level registration quota. Content is licensed under " + (siteMetadata.copyright || "the site license") + ". Automated access should be polite, avoid write methods and follow robots.txt.",
    "",
    "## Contact",
    "",
    "Non-authentication questions or bug reports can be filed at " + issues + ".",
    "",
  ].join("\n");
}

const AGENT_SKILLS = [
  {
    name: "content-discovery",
    description: "Discover prologue.dev's API catalog, OpenAPI, A2A card, MCP server card and machine-readable feeds.",
  },
  {
    name: "markdown-retrieval",
    description: "Fetch any prologue.dev HTML page as Markdown using Accept: text/markdown.",
  },
];

function skillContent(skill) {
  if (skill.name === "content-discovery") {
    return [
      "# Prologue.dev content discovery",
      "",
      "Use this skill to find the public, machine-readable surfaces of prologue.dev before fetching content.",
      "",
      "## Discovery endpoints",
      "",
      "- API catalog: " + BASE + "/.well-known/api-catalog",
      "- OpenAPI 3.1: " + BASE + "/.well-known/openapi.json",
      "- A2A agent card: " + BASE + "/.well-known/agent-card.json",
      "- MCP server card: " + BASE + "/.well-known/mcp/server-card.json",
      "- Auth.md: " + BASE + "/auth.md",
      "- LLM index: " + BASE + "/llms.txt",
      "",
      "## Feeds and corpora",
      "",
      "- RSS: " + BASE + "/rss",
      "- Atom: " + BASE + "/atomfeed",
      "- JSON Feed: " + BASE + "/jsonfeed",
      "- Search corpus: " + BASE + "/search-index.json",
      "- Sitemap: " + BASE + "/sitemap.xml",
      "",
      "## Recommended workflow",
      "",
      "1. Fetch the API catalog and OpenAPI description.",
      "2. Choose a feed or search corpus for bulk discovery.",
      "3. Fetch individual pages as Markdown with Accept: text/markdown.",
      "4. Respect robots.txt and Content-Signal.",
      "",
    ].join("\n");
  }
  return [
    "# Prologue.dev Markdown retrieval",
    "",
    "Every public HTML route on prologue.dev can be requested as Markdown.",
    "",
    "## Request",
    "",
    "Send a GET request with:",
    "",
    "- Accept: text/markdown",
    "",
    "The response is text/markdown with YAML frontmatter and the page body. HTML remains the default for browser requests.",
    "",
    "## Examples",
    "",
    "- " + BASE + "/about",
    "- " + BASE + "/blog/first_job_first_exit_stop_the_bleeding",
    "- " + BASE + "/tags/Inequality",
    "",
    "## Rules",
    "",
    "- Do not send credentials; the content is public.",
    "- Respect robots.txt and the Content-Signal response header.",
    "",
  ].join("\n");
}

async function writeAgentSkills() {
  const index = {
    "$schema": "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [],
  };
  for (const skill of AGENT_SKILLS) {
    const content = skillContent(skill);
    const artifactPath = path.join(OUT_DIR, "agent-skills", skill.name, "SKILL.md");
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, content);
    const digest = "sha256:" + createHash("sha256").update(content, "utf8").digest("hex");
    index.skills.push({
      name: skill.name,
      type: "skill-md",
      description: skill.description,
      url: BASE + "/.well-known/agent-skills/" + skill.name + "/SKILL.md",
      digest,
    });
  }
  await fs.writeFile(path.join(OUT_DIR, "agent-skills", "index.json"), JSON.stringify(index, null, 2) + "\n");
  return index;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "api-catalog"), JSON.stringify(catalog, null, 2) + "\n");
  await fs.writeFile(path.join(OUT_DIR, "openapi.json"), JSON.stringify(openApi(), null, 2) + "\n");
  await fs.writeFile(path.join(OUT_DIR, "api-doc.md"), apiDoc());
  await fs.writeFile(path.join(PUBLIC_DIR, "auth.md"), authDoc());
  await fs.writeFile(path.join(OUT_DIR, "oauth-protected-resource"), JSON.stringify(protectedResourceDoc(), null, 2) + "\n");
  await fs.writeFile(path.join(OUT_DIR, "oauth-authorization-server"), JSON.stringify(authorizationServerDoc(), null, 2) + "\n");
  await fs.writeFile(path.join(OUT_DIR, "agent-card.json"), JSON.stringify(agentCardDoc(), null, 2) + "\n");
  await fs.mkdir(path.join(OUT_DIR, "mcp"), { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "mcp", "server-card.json"), JSON.stringify(mcpCardDoc(), null, 2) + "\n");
  const skillsIndex = await writeAgentSkills();
  await fs.writeFile(path.join(OUT_DIR, "http-message-signatures-directory"), JSON.stringify(webBotAuthDirectory(), null, 2) + "\n");
  console.log(JSON.stringify({ base: BASE, files: ["auth.md", "api-catalog", "openapi.json", "api-doc.md", "oauth-protected-resource", "oauth-authorization-server", "agent-card.json", "mcp/server-card.json", "agent-skills/index.json", "http-message-signatures-directory"], skills: skillsIndex.skills.length, endpoints: Object.keys(PATHS).length }));
}

main().catch((error) => { console.error("[build-api-catalog]", error); process.exit(1); });