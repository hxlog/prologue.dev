/**
 * Sanity checks for the static export output (out/). Run after "yarn export".
 * Exits non-zero on the first structural regression so CI catches a broken
 * export before wrangler deploys it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, extname } from "node:path";

const OUT = process.env.CF_ASSETS_OUT || join(process.cwd(), "out");
const failures = [];
const ok = (cond, message) => { if (!cond) failures.push(message); };

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

ok(existsSync(join(OUT, "index.html")), "out/index.html missing");
ok(existsSync(join(OUT, "404.html")), "out/404.html missing");
ok(existsSync(join(OUT, "_headers")), "out/_headers missing");
ok(existsSync(join(OUT, "_redirects")), "out/_redirects missing");
ok(existsSync(join(OUT, "rss")), "out/rss missing");
ok(existsSync(join(OUT, "atomfeed")), "out/atomfeed missing");
ok(existsSync(join(OUT, "jsonfeed")), "out/jsonfeed missing");
ok(existsSync(join(OUT, "sitemap.xml")), "out/sitemap.xml missing");
ok(existsSync(join(OUT, "robots.txt")), "out/robots.txt missing");
{
  const catalogPath = join(OUT, ".well-known", "api-catalog");
  ok(existsSync(catalogPath), "out/.well-known/api-catalog missing");
  ok(existsSync(join(OUT, ".well-known", "openapi.json")), "out/.well-known/openapi.json missing");
  ok(existsSync(join(OUT, ".well-known", "api-doc.md")), "out/.well-known/api-doc.md missing");
  const webBotAuthPath = join(OUT, ".well-known", "http-message-signatures-directory");
  ok(existsSync(webBotAuthPath), "out/.well-known/http-message-signatures-directory missing");
  const webBotAuth = JSON.parse(readFileSync(webBotAuthPath, "utf8"));
  ok(Array.isArray(webBotAuth.keys) && webBotAuth.keys.length > 0, "Web Bot Auth JWKS must contain keys");
  for (const key of webBotAuth.keys) {
    ok(key.kty === "OKP" && key.crv === "Ed25519" && typeof key.x === "string" && key.x.length > 0, "Web Bot Auth key must be Ed25519 OKP with x");
    ok(typeof key.kid === "string" && key.kid.length > 0, "Web Bot Auth key missing kid");
  }
  const skillsIndexPath = join(OUT, ".well-known", "agent-skills", "index.json");
  ok(existsSync(skillsIndexPath), "out/.well-known/agent-skills/index.json missing");
  const skillsIndex = JSON.parse(readFileSync(skillsIndexPath, "utf8"));
  ok(skillsIndex.$schema === "https://schemas.agentskills.io/discovery/0.2.0/schema.json", "agent skills $schema mismatch");
  ok(Array.isArray(skillsIndex.skills) && skillsIndex.skills.length > 0, "agent skills array missing");
  for (const skill of skillsIndex.skills) {
    ok(/^[a-z0-9-]+$/.test(skill.name), "skill name must be lowercase alphanumeric/hyphens: " + skill.name);
    ok(skill.type === "skill-md" || skill.type === "archive", "skill type invalid: " + skill.type);
    ok(typeof skill.description === "string" && skill.description.length > 0, "skill description missing");
    ok(typeof skill.url === "string" && skill.url.startsWith("https://"), "skill url missing");
    ok(/^sha256:[0-9a-f]{64}$/.test(skill.digest), "skill digest format invalid");
    const rel = new URL(skill.url).pathname.replace(/^\/+/, "");
    const artifact = readFileSync(join(OUT, rel), "utf8");
    const actual = "sha256:" + createHash("sha256").update(artifact, "utf8").digest("hex");
    ok(actual === skill.digest, "skill digest mismatch for " + skill.name);
  }
  const mcpCardPath = join(OUT, ".well-known", "mcp", "server-card.json");
  ok(existsSync(mcpCardPath), "out/.well-known/mcp/server-card.json missing");
  const mcpCard = JSON.parse(readFileSync(mcpCardPath, "utf8"));
  ok(mcpCard.serverInfo?.name && mcpCard.serverInfo?.version, "MCP server card serverInfo missing name/version");
  ok(mcpCard.transport?.endpoint, "MCP server card transport.endpoint missing");
  ok(mcpCard.capabilities && "tools" in mcpCard.capabilities && "resources" in mcpCard.capabilities && "prompts" in mcpCard.capabilities, "MCP server card capabilities missing");
  const cardPath = join(OUT, ".well-known", "agent-card.json");
  ok(existsSync(cardPath), "out/.well-known/agent-card.json missing");
  const card = JSON.parse(readFileSync(cardPath, "utf8"));
  ok(card.name && card.version && card.description, "A2A card missing name/version/description");
  ok(Array.isArray(card.supportedInterfaces) && card.supportedInterfaces[0]?.url && (card.supportedInterfaces[0]?.protocolBinding || card.supportedInterfaces[0]?.transport), "A2A card supportedInterfaces missing url/transport");
  ok(Array.isArray(card.skills) && card.skills.length > 0 && card.skills.every((skill) => skill.id && skill.name && skill.description), "A2A card skills missing required fields");
  for (const name of ["oauth-protected-resource", "oauth-authorization-server"]) {
    const pathname = join(OUT, ".well-known", name);
    ok(existsSync(pathname), "out/.well-known/" + name + " missing");
    const parsed = JSON.parse(readFileSync(pathname, "utf8"));
    ok(typeof parsed.issuer === "string" || typeof parsed.resource === "string", "out/.well-known/" + name + " missing resource/issuer");
  }
  const prm = JSON.parse(readFileSync(join(OUT, ".well-known", "oauth-protected-resource"), "utf8"));
  ok(Array.isArray(prm.authorization_servers) && prm.authorization_servers.length > 0, "PRM authorization_servers missing");
  ok(Array.isArray(prm.scopes_supported), "PRM scopes_supported missing");
  ok(prm.bearer_methods_supported?.includes("header"), "PRM bearer_methods_supported must include header");
  const as = JSON.parse(readFileSync(join(OUT, ".well-known", "oauth-authorization-server"), "utf8"));
  ok(prm.authorization_servers.includes(as.issuer), "AS issuer does not match PRM authorization_servers");
  ok(as.agent_auth && as.agent_auth.register_uri && as.agent_auth.identity_types_supported?.includes("anonymous"), "AS agent_auth anonymous registration missing");
  ok(existsSync(join(OUT, "auth.md")), "out/auth.md missing");
  ok(/^# .*auth\.md/m.test(readFileSync(join(OUT, "auth.md"), "utf8")), "out/auth.md must have an H1 containing auth.md");
  ok(readFileSync(join(OUT, "_headers"), "utf8").includes("/auth.md"), "out/_headers missing /auth.md rule");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  ok(Array.isArray(catalog.linkset) && catalog.linkset.length > 0, "API catalog linkset missing");
  const entry = catalog.linkset[0];
  ok(typeof entry.anchor === "string" && entry.anchor.startsWith("https://"), "API catalog anchor missing");
  for (const relation of ["service-desc", "service-doc"]) {
    ok(Array.isArray(entry[relation]) && entry[relation].length > 0, "API catalog missing " + relation);
    ok(entry[relation][0].href.startsWith("https://"), "API catalog " + relation + " href missing");
  }
  const headers = readFileSync(join(OUT, "_headers"), "utf8");
  ok(headers.includes("/.well-known/api-catalog"), "out/_headers missing API catalog rule");
  ok(headers.includes("Content-Type: application/linkset+json"), "out/_headers missing linkset content type");
  ok(headers.includes('rel="api-catalog"'), "out/_headers missing api-catalog Link relation");
}
{
  const robots = readFileSync(join(OUT, "robots.txt"), "utf8");
  ok(robots.includes("Content-Signal: ai-train=no, search=yes, ai-input=no"), "out/robots.txt missing Content-Signal");
  const groups = (robots.match(/^User-Agent:/gm) || []).length;
  const signals = (robots.match(/^Content-Signal:/gm) || []).length;
  ok(signals === groups, "Content-Signal must be present in every User-Agent group (" + signals + "/" + groups + ")");
}
ok(existsSync(join(OUT, "search-index.json")), "out/search-index.json missing");
ok(existsSync(join(OUT, "search-index-lite.json")), "out/search-index-lite.json missing");
ok(existsSync(join(OUT, "version.json")), "out/version.json missing");
ok(existsSync(join(OUT, "__markdown", "index.md")), "out/__markdown/index.md missing");
ok(
  readFileSync(join(OUT, "__markdown", "index.md"), "utf8").startsWith("---\ntitle:"),
  "out/__markdown/index.md must start with YAML frontmatter"
);
{
  const countByExtension = (extension) => {
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const pathname = join(dir, entry.name);
        if (entry.isDirectory()) walk(pathname);
        else if (entry.name.endsWith(extension)) files.push(pathname);
      }
    };
    walk(join(OUT, "__markdown"));
    return files;
  };
  const mdFiles = countByExtension(".md");
  const htmlFiles = [];
  const walkHtml = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const pathname = join(dir, entry.name);
      if (entry.isDirectory()) walkHtml(pathname);
      else if (entry.name.endsWith(".html")) htmlFiles.push(pathname);
    }
  };
  walkHtml(OUT);
  ok(mdFiles.length === htmlFiles.length, "one Markdown variant per HTML page expected (" + mdFiles.length + "/" + htmlFiles.length + ")");
  ok(existsSync(join(OUT, "__markdown", "blog", "first_job_first_exit_stop_the_bleeding.md")), "sample post Markdown variant missing");
  const headers = readFileSync(join(OUT, "_headers"), "utf8");
  ok(headers.includes("/__markdown/*"), "out/_headers missing /__markdown/* rule");
  ok(headers.includes("Content-Signal: ai-train=no, search=yes, ai-input=no"), "out/_headers missing Content-Signal");
}
ok(existsSync(join(OUT, "sw.js")), "out/sw.js missing");
ok(existsSync(join(OUT, "sw-manifest.json")), "out/sw-manifest.json missing");
try {
  const manifest = JSON.parse(readFileSync(join(OUT, "sw-manifest.json"), "utf8"));
  ok(typeof manifest.version === "string" && manifest.version.length > 0, "sw-manifest version missing");
  ok(Array.isArray(manifest.precache) && manifest.precache.length > 0, "sw-manifest precache empty");
} catch (error) {
  failures.push("sw-manifest.json is not valid JSON: " + error.message);
}

// ---------------------------------------------------------------------------
// out/_headers: security baseline, cache policy, Early Hints preload, budget
// ---------------------------------------------------------------------------

/** Parse the _headers file into [{ pattern, headers: [{name,value}], detach }]. */
function parseHeaderRules(text) {
  const rules = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^[ \t]/.test(line)) {
      current = { pattern: line.trim(), headers: [], detach: [] };
      rules.push(current);
      continue;
    }
    const entry = line.trim();
    if (!current) continue;
    if (entry.startsWith("!")) {
      current.detach.push(entry.slice(1).trim());
      continue;
    }
    const colon = entry.indexOf(":");
    if (colon > 0) {
      current.headers.push({
        name: entry.slice(0, colon).trim(),
        value: entry.slice(colon + 1).trim(),
      });
    }
  }
  return rules;
}

function ruleOf(rules, pattern) {
  return rules.find((rule) => rule.pattern === pattern);
}

function headersOf(rule, name) {
  if (!rule) return [];
  const lower = name.toLowerCase();
  return rule.headers.filter((header) => header.name.toLowerCase() === lower).map((header) => header.value);
}

/**
 * Exact Cache-Control directives of one rule. Exact comparison matters: a
 * substring check for max-age=60 would also pass max-age=600.
 */
function cacheDirectives(rule) {
  return headersOf(rule, "cache-control")
    .flatMap((value) => value.split(","))
    .map((directive) => directive.trim())
    .filter(Boolean);
}

function expectCacheControl(pattern, { includes = [], excludes = [] } = {}) {
  const rule = ruleOf(rules, pattern);
  if (!rule) {
    failures.push("_headers missing rule: " + pattern);
    return;
  }
  const directives = cacheDirectives(rule);
  ok(directives.length > 0, "_headers " + pattern + " has no Cache-Control");
  for (const directive of includes) {
    ok(
      directives.includes(directive),
      "_headers " + pattern + " Cache-Control missing " + directive + " (got: " + directives.join(", ") + ")",
    );
  }
  for (const directive of excludes) {
    ok(
      !directives.includes(directive),
      "_headers " + pattern + " Cache-Control must not contain " + directive + " (got: " + directives.join(", ") + ")",
    );
  }
}

const headersText = readFileSync(join(OUT, "_headers"), "utf8");
const rules = parseHeaderRules(headersText);

ok(rules.length > 0, "out/_headers defines no rules");
ok(rules.length < 100, "out/_headers has " + rules.length + " rules (Workers limit: 100)");
for (const line of headersText.split(/\r?\n/)) {
  ok(line.length < 2000, "_headers line exceeds the 2,000-character limit: " + line.slice(0, 80));
}
ok(rules[0] !== undefined && rules[0].pattern === "/*", "_headers first rule must be the broad /* rule");

// The broad rule: baseline security headers, browser revalidation plus the
// year-long edge TTL, and the shared-stylesheet preload hint (Early Hints).
const broad = rules[0];
for (const securityHeader of [
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "X-Frame-Options",
  "Content-Security-Policy",
]) {
  ok(headersOf(broad, securityHeader).length > 0, "_headers /* missing " + securityHeader);
}
expectCacheControl("/*", { includes: ["max-age=0", "s-maxage=31536000", "must-revalidate"] });

const linkValues = headersOf(broad, "link");
ok(linkValues.length === 1, "out/_headers /* should carry exactly one Link header (got " + linkValues.length + ")");
const preloadCss = [];
for (const value of linkValues) {
  for (const match of value.matchAll(/<([^>]+)>\s*;\s*rel=preload\s*;\s*as=style/g)) preloadCss.push(match[1]);
}
ok(preloadCss.length >= 1, "out/_headers /* missing a rel=preload; as=style Link for the shared stylesheet");
for (const relation of ["api-catalog", "service-desc", "service-doc", "describedby"]) {
  ok(linkValues[0].includes('rel="' + relation + '"'), "out/_headers /* missing rel=" + relation + " Link relation");
}

// RSC payloads: 60 s browser TTL (bounds HTML/RSC version skew), year long edge,
// served as text/plain (the .txt files Next emits are RSC, not downloads).
expectCacheControl("/*.txt", { includes: ["max-age=60", "s-maxage=31536000"] });
ok(
  headersOf(ruleOf(rules, "/*.txt"), "content-type").some((value) => value.startsWith("text/plain")),
  "_headers /*.txt must serve Content-Type text/plain",
);

// Deployment-visible surfaces: browser must revalidate, never a stale copy.
for (const pattern of ["/rss", "/atomfeed", "/jsonfeed", "/microblog/rss"]) {
  expectCacheControl(pattern, {
    includes: ["max-age=0", "must-revalidate"],
    excludes: ["max-age=600"],
  });
}
for (const pattern of ["/sitemap.xml", "/robots.txt", "/search-index.json", "/search-index-lite.json", "/version.json", "/sw.js", "/sw-manifest.json"]) {
  expectCacheControl(pattern, { includes: ["max-age=0", "must-revalidate"] });
}
// The narrow llms rule must override the /*.txt RSC TTL back to revalidation.
expectCacheControl("/llms*.txt", {
  includes: ["max-age=0", "must-revalidate"],
  excludes: ["max-age=60"],
});

// Content types the extensionless files cannot get from their name.
for (const [pattern, expected] of [
  ["/rss", "application/rss+xml"],
  ["/atomfeed", "application/atom+xml"],
  ["/jsonfeed", "application/feed+json"],
  ["/microblog/rss", "application/rss+xml"],
  ["/version.json", "application/json"],
  ["/sitemap.xml", "application/xml"],
  ["/robots.txt", "text/plain"],
]) {
  ok(
    headersOf(ruleOf(rules, pattern), "content-type").some((value) => value.startsWith(expected)),
    "_headers " + pattern + " Content-Type must start with " + expected,
  );
}
// The llms/robots rules override the generic text/plain with a detach, not by
// relying on Cloudflare to join two values.
for (const pattern of ["/llms*.txt", "/robots.txt"]) {
  ok(
    ruleOf(rules, pattern)?.detach.some((name) => name.toLowerCase() === "content-type"),
    "_headers " + pattern + " must detach Content-Type before overriding it",
  );
}

// Content-hashed assets are immutable at both browser and edge.
for (const pattern of ["/_next/static/*", "/static/opt/*", "/static/variants/*", "/static/source/*", "/og/*"]) {
  expectCacheControl(pattern, { includes: ["max-age=31536000", "immutable"] });
}
expectCacheControl("/static/*", { includes: ["max-age=604800"] });

// Detach discipline: a rule that sets Cache-Control after the broad rule must
// detach the inherited value first, otherwise Cloudflare joins both values and
// the duplicate max-age makes the response stale/undefined (RFC 9111).
for (const [index, rule] of rules.entries()) {
  const setsCacheControl = rule.headers.some((header) => header.name.toLowerCase() === "cache-control");
  if (!setsCacheControl) continue;
  const detached = rule.detach.some((name) => name.toLowerCase() === "cache-control");
  if (index === 0) ok(!detached, "_headers /* should not detach its own Cache-Control");
  else ok(detached, "_headers " + rule.pattern + " sets Cache-Control without a preceding '! Cache-Control'");
}

// Existing security/content-type expectations stay in force.
for (const needle of [
  "Referrer-Policy",
  "Permissions-Policy",
  "X-Frame-Options",
  "Content-Security-Policy",
  "/version.json",
]) {
  ok(headersText.includes(needle), "out/_headers missing " + needle);
}
for (const needle of ["/rss", "application/rss+xml", "/og/*", "immutable"]) {
  ok(headersText.includes(needle), "_headers missing rule: " + needle);
}

// ---------------------------------------------------------------------------
// File tree, HTML payloads and the shared stylesheet targeted by the preload
// ---------------------------------------------------------------------------

const files = walk(OUT);
ok(files.length < 20000, "out/ has " + files.length + " files (>20,000 static-asset limit)");
const biggest = files.reduce((m, f) => Math.max(m, statSync(f).size), 0);
ok(biggest < 25 * 1024 * 1024, "largest asset is " + Math.round(biggest / 1024 / 1024) + " MiB (>25 MiB limit)");

const ogFiles = files.filter((f) => f.includes(join("out", "og") + sep()) || f.includes("/og/"));
ok(ogFiles.length >= 1, "no generated OG cards in out/og");

const html = files.filter((f) => extname(f) === ".html");
ok(html.length >= 85, "only " + html.length + " prerendered HTML files");

// HTML file -> set of stylesheet hrefs it links (for the shared-CSS check).
const stylesheetPages = new Map();
for (const f of html) {
  const body = readFileSync(f, "utf8");
  if (body.includes("/_next/image")) failures.push("HTML contains /_next/image: " + f);
  // Metadata must use the static cards; article prose may legitimately mention
  // the old query URL, so only assert on the meta tag itself.
  const ogMeta = body.match(/property="og:image" content="([^"]+)"/);
  if (ogMeta && ogMeta[1].includes("/og?")) failures.push("og:image still points at dynamic /og?: " + f);
  const stylesheets = new Set();
  for (const match of body.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel="stylesheet"/i.test(tag)) continue;
    const href = /\bhref="([^"]+)"/i.exec(tag);
    if (href) stylesheets.add(href[1]);
  }
  stylesheetPages.set(f, stylesheets);
}

for (const href of preloadCss) {
  ok(href.startsWith("/_next/static/"), "preload Link is not a hashed Next stylesheet: " + href);
  ok(href.endsWith(".css"), "preload Link is not a .css file: " + href);
  ok(existsSync(join(OUT, href.replace(/^\/+/, ""))), "preload CSS missing from out/: " + href);
  const missing = [...stylesheetPages.entries()]
    .filter(([, stylesheets]) => !stylesheets.has(href))
    .map(([file]) => file);
  ok(
    missing.length === 0,
    "preload CSS " + href + " is not linked by every HTML page (" + missing.length + " missing, e.g. " + (missing[0] ?? "") + ")",
  );
}

if (failures.length) {
  console.error("verify-export FAILED:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log(
  "verify-export OK: " +
    files.length +
    " files, " +
    html.length +
    " HTML, " +
    ogFiles.length +
    " OG cards, " +
    rules.length +
    " header rules, preload " +
    preloadCss.join(", ") +
    ", largest " +
    (biggest / 1024).toFixed(0) +
    " KB",
);
function sep() { return process.platform === "win32" ? "\\" : "/"; }