/**
 * Markdown for Agents content negotiation for the static site.
 *
 * The zone is on Cloudflare's Free plan, where the native content_converter
 * (Markdown for Agents) is not available. This thin Worker runs before the
 * static assets and adds the same content-negotiation contract:
 *
 *   Accept: text/markdown -> out/__markdown/<route>.md as text/markdown
 *   anything else         -> the existing static HTML/asset from ASSETS
 *
 * The Markdown variants are generated at build time by
 * scripts/build-markdown.mjs, so request handling stays CPU-free: one ASSETS
 * lookup, no runtime conversion. HTML remains the default and is never changed.
 *
 * wrangler.jsonc routes every request through this Worker:
 *   assets.binding = "ASSETS", assets.run_worker_first = true.
 */
const CONTENT_SIGNAL = "ai-train=no, search=yes, ai-input=no";
const MARKDOWN_PREFIX = "/__markdown";

/** The response should prefer Markdown over HTML for this Accept header. */
function prefersMarkdown(accept) {
  if (!accept) return false;

  const quality = (type) => {
    let best = null;
    for (const rawPart of accept.split(",")) {
      const [mediaType, ...params] = rawPart.trim().toLowerCase().split(";");
      if (mediaType !== type) continue;
      let q = 1;
      for (const param of params) {
        const [key, value] = param.trim().split("=");
        if (key === "q") {
          const parsed = Number.parseFloat(value);
          if (Number.isFinite(parsed)) q = parsed;
        }
      }
      if (best === null || q > best) best = q;
    }
    return best;
  };

  const markdown = quality("text/markdown");
  if (markdown === null || markdown <= 0) return false;
  const html = quality("text/html");
  if (html !== null && html > markdown) return false;
  return true;
}

/** Public route path -> prebuilt Markdown asset path. */
function markdownAssetPath(pathname) {
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    path = pathname;
  }
  path = path.replace(/\/+$/, "");
  if (path === "") return MARKDOWN_PREFIX + "/index.md";
  if (path.endsWith(".html")) path = path.slice(0, -".html".length);
  if (path.includes("\0") || path.includes("\\") || path.split("/").includes("..")) return null;
  return MARKDOWN_PREFIX + path + ".md";
}

function mergeVary(headers) {
  const current = headers.get("vary");
  if (!current) {
    headers.set("vary", "Accept");
    return;
  }
  const values = current.split(",").map((value) => value.trim().toLowerCase());
  if (!values.includes("accept")) headers.set("vary", current + ", Accept");
}

function htmlResponse(response) {
  const headers = new Headers(response.headers);
  mergeVary(headers);
  headers.set("content-signal", CONTENT_SIGNAL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function markdownResponse(request, env, url) {
  const assetPath = markdownAssetPath(url.pathname);
  if (!assetPath) return null;

  const assetUrl = new URL(assetPath, url.origin);
  const assetRequest = new Request(assetUrl.toString(), {
    method: "GET",
    headers: request.headers,
  });
  const asset = await env.ASSETS.fetch(assetRequest);
  if (!asset.ok) return null;

  const markdown = await asset.text();
  const headers = new Headers(asset.headers);
  headers.set("content-type", "text/markdown; charset=utf-8");
  mergeVary(headers);
  headers.set("content-signal", CONTENT_SIGNAL);
  headers.set("cache-control", "public, max-age=0, s-maxage=31536000, must-revalidate");
  headers.set("x-markdown-tokens", String(Math.max(1, Math.ceil(markdown.length / 4))));
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("content-range");
  headers.delete("etag");
  headers.delete("last-modified");

  return new Response(request.method === "HEAD" ? null : markdown, {
    status: 200,
    headers,
  });
}

/** JSON response for the anonymous agent-registration endpoints. */
function agentJson(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function newAnonymousCredential() {
  const id = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  return {
    agent_id: "agent_" + id,
    access_token: "anon_" + id,
    token_type: "Bearer",
    credential_type: "urn:prologue:anonymous-agent-credential",
    expires_in: 3600,
    register_uri: "https://prologue.dev/agent/auth",
  };
}

function agentEndpoint(request, url) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-max-age": "86400",
      },
    });
  }

  if (url.pathname === "/agent/auth" && request.method === "POST") {
    return agentJson(201, newAnonymousCredential());
  }
  if (url.pathname === "/agent/token" && request.method === "POST") {
    const credential = newAnonymousCredential();
    return agentJson(200, {
      access_token: credential.access_token,
      token_type: "Bearer",
      expires_in: credential.expires_in,
      scope: "content:read",
    });
  }
  if (url.pathname === "/agent/claim" && request.method === "GET") {
    return agentJson(200, {
      status: "not_required",
      message: "Anonymous registration does not require a human claim ceremony.",
      claim_uri: "https://prologue.dev/agent/claim",
    });
  }
  if (url.pathname === "/agent/revoke" && request.method === "POST") {
    return agentJson(200, {
      revoked: true,
      message: "Anonymous credentials are ephemeral and are not stored server-side.",
    });
  }
  if (url.pathname === "/agent/authorize" && request.method === "GET") {
    return agentJson(200, {
      status: "anonymous_only",
      message: "POST /agent/auth for anonymous registration; no browser authorization flow is supported.",
      register_uri: "https://prologue.dev/agent/auth",
    });
  }
  return agentJson(405, { error: "method_not_allowed" });
}

/** Minimal A2A JSON-RPC endpoint advertised by the agent card. */
async function a2aEndpoint(request) {
  const cors = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  };
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, a2a-version, a2a-extensions",
      },
    });
  }
  if (request.method === "GET") {
    return new Response(JSON.stringify({
      name: "Prologue Content Agent",
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
      agentCard: "https://prologue.dev/.well-known/agent-card.json",
    }), { status: 200, headers: cors });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: cors });
  }

  let payload;
  try { payload = await request.json(); } catch {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), { status: 400, headers: cors });
  }
  const id = payload?.id ?? null;
  const method = payload?.method;
  const reply = (result) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200, headers: cors });

  if (method === "message/send" || method === "SendMessage") {
    const params = payload.params || {};
    const contextId = params.message?.contextId || params.contextId || crypto.randomUUID();
    return reply({
      messageId: crypto.randomUUID(),
      role: "agent",
      contextId,
      parts: [{
        text: "Prologue content agent: public discovery is at https://prologue.dev/.well-known/api-catalog, OpenAPI at https://prologue.dev/.well-known/openapi.json, and any HTML route can be fetched as Markdown with Accept: text/markdown.",
      }],
    });
  }
  if (method === "tasks/get" || method === "GetTask") {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32001, message: "Task not found; this stateless agent returns direct messages." } }), { status: 200, headers: cors });
  }
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }), { status: 200, headers: cors });
}

/** Minimal stateless MCP Streamable HTTP JSON-RPC endpoint. */
async function mcpEndpoint(request) {
  const cors = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  };
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id",
      },
    });
  }
  if (request.method === "GET") {
    return new Response(JSON.stringify({
      name: "Prologue MCP Content Server",
      transport: "streamable-http",
      endpoint: "https://prologue.dev/mcp",
      serverCard: "https://prologue.dev/.well-known/mcp/server-card.json",
    }), { status: 200, headers: cors });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: cors });
  }

  let payload;
  try { payload = await request.json(); } catch {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), { status: 400, headers: cors });
  }
  if (!payload || payload.id === undefined) {
    return new Response(null, { status: 202, headers: cors });
  }
  const id = payload.id;
  const method = payload.method;
  const result = (value) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result: value }), { status: 200, headers: cors });
  const error = (code, message) => new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), { status: 200, headers: cors });

  if (method === "initialize") {
    return result({
      protocolVersion: "2025-06-18",
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
        prompts: { listChanged: false },
      },
      serverInfo: { name: "Prologue MCP Content Server", version: "1.0.0" },
    });
  }
  if (method === "tools/list") {
    return result({
      tools: [
        {
          name: "site_discovery",
          description: "List the public machine-readable discovery surfaces of prologue.dev.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
        {
          name: "get_markdown",
          description: "Return a Markdown URL for a public HTML path such as /about or /blog/<slug>.",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string", description: "Root-relative public path" } },
            required: ["path"],
          },
        },
      ],
    });
  }
  if (method === "tools/call") {
    const name = payload.params?.name;
    const args = payload.params?.arguments || {};
    if (name === "site_discovery") {
      return result({
        content: [{
          type: "text",
          text: "API catalog: https://prologue.dev/.well-known/api-catalog\nOpenAPI: https://prologue.dev/.well-known/openapi.json\nAuth: https://prologue.dev/auth.md\nA2A card: https://prologue.dev/.well-known/agent-card.json\nFeeds: https://prologue.dev/rss, https://prologue.dev/atomfeed, https://prologue.dev/jsonfeed\nSearch corpus: https://prologue.dev/search-index.json",
        }],
        isError: false,
      });
    }
    if (name === "get_markdown") {
      const path = typeof args.path === "string" && args.path.startsWith("/") && !args.path.includes("..") ? args.path : "/";
      return result({
        content: [{ type: "text", text: "Fetch https://prologue.dev" + path + " with Accept: text/markdown." }],
        isError: false,
      });
    }
    return error(-32602, "Unknown tool");
  }
  if (method === "resources/list") {
    return result({
      resources: [
        { uri: "https://prologue.dev/.well-known/api-catalog", name: "API catalog", mimeType: "application/linkset+json" },
        { uri: "https://prologue.dev/.well-known/openapi.json", name: "OpenAPI description", mimeType: "application/vnd.oai.openapi+json;version=3.1" },
        { uri: "https://prologue.dev/auth.md", name: "Auth.md", mimeType: "text/markdown" },
        { uri: "https://prologue.dev/.well-known/agent-card.json", name: "A2A agent card", mimeType: "application/json" },
      ],
    });
  }
  if (method === "resources/read") {
    const uri = payload.params?.uri;
    if (typeof uri === "string" && uri.startsWith("https://prologue.dev/")) {
      return result({ contents: [{ uri, mimeType: "text/plain", text: "Fetch " + uri + " over HTTPS." }] });
    }
    return error(-32602, "Unknown resource");
  }
  if (method === "prompts/list") return result({ prompts: [] });
  return error(-32601, "Method not found");
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      return mcpEndpoint(request);
    }
    if (url.pathname === "/a2a") {
      return a2aEndpoint(request);
    }
    if (url.pathname.startsWith("/agent/")) {
      return agentEndpoint(request, url);
    }

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      !url.pathname.startsWith(MARKDOWN_PREFIX + "/") &&
      prefersMarkdown(request.headers.get("accept"))
    ) {
      const markdown = await markdownResponse(request, env, url);
      if (markdown) return markdown;
    }

    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.toLowerCase().includes("text/html")) return htmlResponse(response);
    return response;
  },
};

export default worker;