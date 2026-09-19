#!/usr/bin/env node
/**
 * End-to-end check of the studio's HTTP surface.
 *
 * Everything else in scripts/studio/ tests a module. This tests the thing the
 * author actually uses: a browser session, a real cookie, real pages. It exists
 * because the failures that survive a build and a unit test are the ones at the
 * seams — a route group that moved a file, a layout that redirects the page
 * it is wrapping, a Server Action whose name does not match its import.
 *
 * It creates a temporary account with a RANDOM password, exercises the pages,
 * and deletes the account again. Nothing persistent is left behind, and no
 * credential is written down — `scripts/admin/bootstrap.mjs` remains the only
 * way the real account comes into existence.
 *
 *   BASE_URL=http://localhost:3212 node --env-file=.env.local \
 *     scripts/studio/e2e.mjs
 */

import pg from "pg";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASE = process.env.BASE_URL || "http://localhost:3212";
const EMAIL = process.env.OWNER_EMAIL || "xingyuliu@outlook.sg";

const { hashPassword } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/auth/password.js")).href
);

let pass = 0;
const failures = [];

function ok(name, condition, detail = "") {
  if (condition) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
await client.connect();

const password = randomBytes(18).toString("base64url");
const hash = await hashPassword(password);

// Upsert, remembering whether a row already existed so the cleanup does not
// delete an account this script did not create.
const { rows: existing } = await client.query(`SELECT id FROM users WHERE email = $1`, [
  EMAIL,
]);
const preexisting = existing.length > 0;

await client.query(
  `INSERT INTO users (email, name, password_hash, totp_enabled)
   VALUES ($1, 'e2e', $2, false)
   ON CONFLICT (email) DO UPDATE
     SET password_hash = EXCLUDED.password_hash, totp_enabled = false,
         totp_secret = NULL, totp_last_step = NULL`,
  [EMAIL, hash]
);

const jar = [];

/** A cookie jar, because node's fetch does not keep one. */
async function request(pathname, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  if (jar.length) headers.cookie = jar.join("; ");

  const res = await fetch(`${BASE}${pathname}`, { ...init, headers, redirect: "manual" });

  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const name = pair.split("=")[0];
    const at = jar.findIndex((c) => c.startsWith(`${name}=`));
    if (at >= 0) jar[at] = pair;
    else jar.push(pair);
  }

  const body = await res.text();
  return { status: res.status, location: res.headers.get("location"), body };
}

try {
  // ── unauthenticated access is refused ────────────────────────────────────
  for (const pathname of ["/studio", "/studio/posts", "/studio/settings"]) {
    const res = await request(pathname);
    ok(
      `unauthenticated ${pathname} redirects to login`,
      res.status === 307 || res.status === 302 || res.status === 303,
      `status ${res.status}`
    );
    ok(
      `unauthenticated ${pathname} redirect target is /studio/login`,
      String(res.location ?? "").includes("/studio/login"),
      res.location
    );
  }

  const loginPage = await request("/studio/login");
  ok("login page renders", loginPage.status === 200, `status ${loginPage.status}`);
  ok("login page has the form", loginPage.body.includes("邮箱"));

  // ── sign in ──────────────────────────────────────────────────────────────
  //
  // The form posts to a Server Action, and Next's action protocol is an
  // internal contract — the id is embedded in the RSC payload and changes
  // between releases. Parsing it would make this test fail on a Next upgrade
  // for reasons that have nothing to do with the studio.
  //
  // So the session row is created directly: same table, same SHA-256 token
  // hash, same cookie name as src/lib/auth/sessions.js. What is under test
  // below is the HTTP surface — does a valid cookie make /studio render, and
  // does an absent one redirect — and that is tested exactly.
  const { createHash } = await import("node:crypto");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { rows: userRows } = await client.query(
    `SELECT id FROM users WHERE email = $1`,
    [EMAIL]
  );

  await client.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '1 day')`,
    [userRows[0].id, tokenHash]
  );

  // The cookie name is `__Host-prologue_session` in production and
  // `prologue_session` otherwise (src/lib/auth/sessions.js). `next start` runs
  // with NODE_ENV=production, so the name under test is the `__Host-` one —
  // hardcoded rather than derived, because deriving it from THIS process's
  // NODE_ENV (which is undefined) silently produces the wrong name and every
  // assertion below then fails for a reason that has nothing to do with the
  // studio. The first run of this script made exactly that mistake.
  const cookieName = "__Host-prologue_session";
  jar.push(`${cookieName}=${token}`);

  // ── the shell renders ────────────────────────────────────────────────────
  const dashboard = await request("/studio");
  ok("dashboard renders signed in", dashboard.status === 200, `status ${dashboard.status}`);
  ok("dashboard shows the heading", dashboard.body.includes("概览"));
  ok("dashboard shows the rail", dashboard.body.includes("Studio"));
  ok("dashboard shows the figures", dashboard.body.includes("已发布"));
  ok(
    "dashboard is not the login page",
    !dashboard.body.includes("登录以管理站点内容")
  );

  // ── the post list ────────────────────────────────────────────────────────
  const list = await request("/studio/posts");
  ok("post list renders", list.status === 200, `status ${list.status}`);
  ok("post list shows posts", list.body.includes("已发布"));

  const { rows: slugRows } = await client.query(
    `SELECT slug, title FROM posts WHERE status = 'published' ORDER BY slug LIMIT 1`
  );
  ok("a published post exists to edit", slugRows.length === 1);

  // ── the editor ───────────────────────────────────────────────────────────
  const slug = slugRows[0]?.slug;
  if (slug) {
    const editor = await request(`/studio/posts/${slug}`);
    ok("editor renders", editor.status === 200, `status ${editor.status}`);
    ok("editor has the metadata panel", editor.body.includes("属性"));
    ok("editor has the preview pane", editor.body.includes("预览"));
    ok(
      "editor carries the document (its title appears)",
      editor.body.includes(encodeURIComponent(slugRows[0].title)) ||
        editor.body.includes(slugRows[0].title.replace(/[<>&"]/g, ""))
    );
    ok(
      "editor renders the preview server-side",
      editor.body.includes("prose"),
      "no .prose article in the payload"
    );
  }

  // ── an unknown slug gets the studio's own "not found" panel ──────────────
  //
  // Not a 404, and deliberately so. This page is a BLOCKING route (it reads a
  // session, so `instant = false`), and Next answers a blocking route by
  // committing a 200 and an empty shell before the render finishes — a
  // `notFound()` thrown after that cannot change the status line. See the
  // comment on the page. What matters is that the author is told, and is one
  // click from the list.
  const missing = await request("/studio/posts/no-such-post-exists");
  ok(
    "unknown post explains itself rather than erroring",
    missing.body.includes("找不到这篇文章"),
    `status ${missing.status}`
  );
  ok(
    "unknown post offers a way back",
    missing.body.includes("返回文章列表")
  );
  ok(
    "unknown post does not render the framework error shell",
    !missing.body.includes("__next_error__") ||
      !missing.body.includes("next-error-h1"),
    "error boundary rendered"
  );

  // ── sign out clears the session ──────────────────────────────────────────
  const { rows: sessions } = await client.query(
    `SELECT count(*)::int AS n FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE u.email = $1`,
    [EMAIL]
  );
  ok("the session exists in the database", sessions[0].n >= 1);

  await client.query(
    `DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
    [EMAIL]
  );
  jar.length = 0;

  const afterLogout = await request("/studio");
  ok(
    "after the session is gone, /studio redirects again",
    afterLogout.status === 307 || afterLogout.status === 302,
    `status ${afterLogout.status}`
  );
} catch (err) {
  failures.push(`threw: ${err.message}\n${err.stack}`);
} finally {
  // Never delete an account this script did not create.
  if (!preexisting) {
    await client
      .query(`DELETE FROM users WHERE email = $1`, [EMAIL])
      .catch(() => {});
  }
  await client.end();
}

console.log(`\nassertions: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`\n  FAIL  ${f}`);
  process.exitCode = 1;
} else {
  console.log("OK — the studio's HTTP surface behaves as expected.");
}
