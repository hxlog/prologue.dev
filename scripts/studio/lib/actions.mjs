/**
 * Drive the real Server Actions over HTTP.
 *
 * Discovery: `.next/static/chunks/*.js` contains
 * `createServerReference)("<id>", …, "<exportName>")` for every action, so the
 * name→id map is readable from the build. The ids are internal, but they are
 * also STABLE for a given build, and reading them beats hardcoding them.
 *
 * Calling: POST to any page of the app with
 *   Next-Action: <id>
 *   Content-Type: text/plain;charset=UTF-8
 *   body: JSON array of the action's arguments
 * and the reply is a flight stream. `x-action-redirect` is set when the action
 * called redirect().
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { randomBytes, createHash } from "node:crypto";

const BASE = process.env.BASE_URL || "http://localhost:3220";
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

// ── the name → id map, read out of the client chunks ─────────────────────────
const CHUNKS = path.join(ROOT, ".next/static/chunks");
export function actionIds() {
  const map = new Map();
  const re =
    /createServerReference\)\("([0-9a-f]+)",[a-zA-Z.$]*\.callServer,void 0,[a-zA-Z.$]*\.findSourceMapURL,"([a-zA-Z]+)"\)/g;
  for (const file of fs.readdirSync(CHUNKS)) {
    if (!file.endsWith(".js")) continue;
    const text = fs.readFileSync(path.join(CHUNKS, file), "utf8");
    for (const m of text.matchAll(re)) map.set(m[2], m[1]);
  }
  return map;
}

export function sessionFor(userId, db) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return db
    .query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '10 minutes') RETURNING token_hash`,
      [userId, tokenHash]
    )
    .then(() => ({ token, cookie: `__Host-prologue_session=${token}` }));
}

/**
 * Call one action.
 *
 * `pagePath` is REQUIRED and is the page the action is registered on. Posting an
 * action id to a page that does not register it does not fail — it answers 200
 * with a two-byte `{}`, which reads exactly like an action that ran and returned
 * nothing. That cost an hour of debugging, so it is no longer defaulted.
 */
export async function callAction(ids, cookie, name, args, { pagePath } = {}) {
  const id = ids.get(name);
  if (!id) {
    throw new Error(
      `no action id for ${name}. Either the build is stale (run \`npm run build\`), ` +
        `or nothing in src/ imports it — an action with no caller is never ` +
        `registered, which is itself a finding.`
    );
  }
  if (!pagePath) throw new Error(`callAction(${name}) needs a pagePath`);

  const res = await fetch(`${BASE}${pagePath}`, {
    method: "POST",
    headers: {
      cookie,
      "Next-Action": id,
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "text/x-component",
    },
    body: JSON.stringify(args),
    redirect: "manual",
  });

  const text = await res.text();

  return {
    status: res.status,
    redirect: res.headers.get("x-action-redirect"),
    result: readResult(text),
    text,
  };
}

/**
 * Parse a React flight stream into its id → value map.
 *
 * The format is `<id>:<payload>` per line, EXCEPT for one thing that breaks
 * every naive reader: a long string is emitted as a text chunk,
 *
 *     T<hex-length>,<content — exactly that many UTF-8 BYTES, verbatim>
 *
 * and that marker can appear ANYWHERE, including in the middle of a JSON
 * payload. An action returning a 9 KB HTML body therefore produces
 *
 *     1:{"ok":true,…,"html":"<p>…",…}
 *
 * for a small document and
 *
 *     1:{"ok":true,…,"html":
 *     T2256,<p>…</p>
 *     ,"unknownTags":[]}
 *
 * for a large one — three lines that are one value. Two things this cost:
 *
 *   - The declared length counts BYTES, not characters. This corpus is
 *     Chinese, so slicing that many characters overruns by about a third,
 *     lands the reader inside the next line, and every `id:` after it is a
 *     piece of prose.
 *   - Parsing line by line finds no parseable object at all, so a SUCCESSFUL
 *     save reads as an action that returned nothing.
 *
 * So: splice every text chunk back into the stream as a JSON string literal
 * first, which makes the whole thing line-oriented again, and only then parse.
 * `Buffer.byteLength` is what tells us where a chunk actually ends.
 */
function parseFlight(text) {
  const normalised = spliceTextChunks(text);

  const chunks = new Map();
  for (const line of normalised.split("\n")) {
    const sep = line.indexOf(":");
    if (sep <= 0) continue;

    const id = line.slice(0, sep);
    const payload = line.slice(sep + 1);
    if (payload.startsWith("I[")) continue;

    try {
      chunks.set(id, JSON.parse(payload));
    } catch {
      /* X, C, a client reference — not a value this test needs */
    }
  }
  return chunks;
}

/**
 * Replace every `T<len>,<content>` marker with a JSON string literal of its
 * content, reading `len` as UTF-8 bytes, and terminate that literal with a
 * newline.
 *
 * The newline is the substitution's whole point and not cosmetic. React emits
 * text chunks with NO trailing separator — the length is what delimits them —
 * so the stream carries
 *
 *     10:T2256,<content>1:{"ok":true,…}
 *
 * with the next chunk glued to the closing quote of this one. Splicing without
 * a terminator leaves `10:"…"1:{…}` on one line, the line no longer starts with
 * an id, and the action's answer is lost for the second time in a row.
 *
 * Scanning from the front is safe because a chunk is never re-entered: its
 * length is what defines its content.
 */
function spliceTextChunks(text) {
  let out = "";
  let i = 0;

  while (i < text.length) {
    const marker = /(^|\n)([0-9a-f]+):T([0-9a-f]+),/.exec(text.slice(i));
    if (!marker) {
      out += text.slice(i);
      break;
    }

    const at = i + marker.index;
    const prefixEnd = at + marker[1].length;
    out += text.slice(i, prefixEnd);
    out += `${marker[2]}:`;

    const contentStart = at + marker[0].length;
    const bytes = parseInt(marker[3], 16);

    // Character count is an upper bound on bytes consumed — every character is
    // at least one byte — so the slice is trimmed until the byte length fits.
    let end = Math.min(contentStart + bytes, text.length);
    while (end > contentStart && Buffer.byteLength(text.slice(contentStart, end), "utf8") > bytes) {
      end--;
    }

    out += `${JSON.stringify(text.slice(contentStart, end))}\n`;
    i = end;
  }

  return out;
}

/**
 * The action's return value.
 *
 * The reply also carries the re-rendered page tree, so there are many objects
 * and only one of them is the answer: the one with an `ok` key, since every
 * action in this app returns one. That is a convention rather than a contract,
 * which is why a miss returns null and the test reports it rather than
 * silently asserting against the page tree.
 */
function readResult(text) {
  const chunks = parseFlight(text);

  for (const value of chunks.values()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (!("ok" in value)) continue;
    return resolve(value, chunks);
  }
  return null;
}

/** Replace `"$N"` references with the chunk they name, to a bounded depth. */
function resolve(value, chunks, depth = 0) {
  // A flight reference is the whole string, not an interpolation — and this
  // check has to come BEFORE the object test, because the thing being replaced
  // is itself a string. Returning early on `typeof value !== "object"` left the
  // reference unresolved and the test comparing a 9 KB document against `"$10"`.
  if (typeof value === "string") {
    if (!/^\$[0-9a-f]+$/.test(value)) return value;
    const target = chunks.get(value.slice(1));
    return target === undefined ? null : resolve(target, chunks, depth + 1);
  }

  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => resolve(v, chunks, depth + 1));

  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = resolve(v, chunks, depth + 1);
  return out;
}

// ── standalone run: sign in, create a post, read it back ────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const ids = actionIds();
  console.log(`${ids.size} server actions discovered in the build`);

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  await client.connect();

  const { rows: users } = await client.query(`SELECT id FROM users LIMIT 1`);
  if (!users.length) {
    console.error("no user — run scripts/admin/bootstrap.mjs");
    process.exit(1);
  }
  const { cookie } = await sessionFor(users[0].id, client);

  const created = await callAction(ids, cookie, "createPostAction", [
    { title: "Probe 探针" },
  ]);
  console.log("createPostAction:", created.status, JSON.stringify(created.result));
  const slug = created.result?.slug;
  console.log("slug:", slug);

  if (slug) {
    const saved = await callAction(ids, cookie, "autosavePost", [
      slug,
      {
        markdown: "---\ntitle: \"Probe 探针\"\n---\n\nhello **world**\n",
        meta: { title: "Probe 探针" },
        revision: 1,
      },
    ]);
    console.log("autosavePost:", saved.status, JSON.stringify(saved.result));

    const published = await callAction(ids, cookie, "publishPostAction", [slug]);
    console.log("publishPostAction:", published.status, JSON.stringify(published.result));

    const page = await fetch(`${BASE}/blog/${slug}`);
    const html = await page.text();
    console.log(`/blog/${slug}: ${page.status}, ${html.length} bytes`);
    console.log("  contains 'hello world':", /hello\s*<strong>world<\/strong>/.test(html));

    const gone = await callAction(ids, cookie, "deletePostAction", [slug, slug]);
    console.log("deletePostAction:", gone.status, JSON.stringify(gone.result));
  }

  await client.query(`DELETE FROM sessions`);
  await client.end();
}
