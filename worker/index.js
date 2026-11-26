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

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

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
