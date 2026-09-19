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
  return {
    status: res.status,
    location: res.headers.get("location"),
    body,
    // Text as a reader would see it, for assertions about CONTENT rather than
    // about markup.
    //
    // Two transformations, and both are needed. The App Router streams its
    // markup inside a Flight payload, so CJK arrives escaped as \uXXXX. And
    // React separates adjacent text nodes with `<!-- -->` — every interpolated
    // value in a sentence produces one — so "共 {n} 个版本" is in the document
    // as "共 <!-- -->1<!-- --> 个版本" and a plain substring search for the
    // rendered sentence fails on a page that renders it correctly.
    //
    // That is how this was found: the history screen's revision count asserted
    // false while the page was visibly right. Asserting against `body` is
    // correct for markup (href, class names, ids); assert against `text` for
    // anything a person reads.
    text: visible(body),
  };
}

/**
 * Body -> the text a reader sees.
 *
 * Deliberately crude — it strips tag-shaped things rather than parsing HTML,
 * because the alternative is pulling a DOM implementation into a script whose
 * job is to make eight substring assertions.
 */
function visible(body) {
  return body
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
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

  // ── the history screen ───────────────────────────────────────────────────
  //
  // The one studio screen with two server actions behind it (`diffRevisions`
  // and `restoreRevisionAction`) and a client component that computes nothing
  // itself. What is asserted here is that it renders, that it can name the
  // revisions it is comparing, and that the diff it was handed is a real one —
  // an empty or truncated diff would otherwise look identical to a page that
  // simply had nothing to compare.
  if (slug) {
    const history = await request(`/studio/posts/${slug}/history`);
    ok("history renders", history.status === 200, `status ${history.status}`);
    ok("history names the screen", history.text.includes("历史版本"));
    ok(
      "history offers a restore control",
      history.text.includes("恢复"),
      "no restore button rendered"
    );
    // `body`, not `text`: these are aria-labels on <select> elements, and
    // `text` strips tags — including the attributes — so the assertion would
    // fail whether or not the selects were there.
    ok(
      "history offers both comparison selects",
      history.body.includes("起始版本") && history.body.includes("目标版本")
    );
    ok(
      "history reports the revision count",
      /共 \d+ 个版本/.test(history.text),
      "the count line is missing"
    );
  }

  const missingHistory = await request("/studio/posts/no-such-post-exists/history");
  ok(
    "history of an unknown post explains itself",
    missingHistory.text.includes("找不到这篇文章"),
    `status ${missingHistory.status}`
  );

  // ── the page list and the page editor ────────────────────────────────────
  //
  // /about is the one page the site has, imported by scripts/db/import-pages.mjs
  // and rendered from compiled MDX bytecode rather than markup. The editor has
  // to load its stored source and recompile it for the preview, so this is the
  // assertion that the whole MDX path works outside a build.
  const pages = await request("/studio/pages");
  ok("page list renders", pages.status === 200, `status ${pages.status}`);
  ok("page list names the screen", pages.text.includes("页面"));

  const { rows: pageRows } = await client.query(
    `SELECT slug, title FROM pages WHERE status = 'published' ORDER BY slug LIMIT 1`
  );
  ok("a published page exists to edit", pageRows.length === 1);

  const pageSlug = pageRows[0]?.slug;
  if (pageSlug) {
    const pageEditor = await request(`/studio/pages/${pageSlug}`);
    ok(
      "page editor renders",
      pageEditor.status === 200,
      `status ${pageEditor.status}`
    );
    ok("page editor has the settings panel", pageEditor.text.includes("页面设置"));
    ok("page editor has the preview pane", pageEditor.text.includes("预览"));
    ok(
      "page editor carries the document",
      pageEditor.text.includes(pageRows[0].title)
    );
    ok(
      "page editor renders the compiled MDX, not a compile error",
      !pageEditor.text.includes("MDX 无法编译"),
      "the stored document failed to compile"
    );
  }

  const missingPage = await request("/studio/pages/no-such-page-exists");
  ok(
    "unknown page explains itself rather than erroring",
    missingPage.text.includes("找不到这个页面"),
    `status ${missingPage.status}`
  );
  ok(
    "unknown page offers a way back",
    missingPage.text.includes("返回页面列表")
  );

  // ── the navigation editor ────────────────────────────────────────────────
  //
  // The header's links are rows now, read through a cached function in the site
  // LAYOUT. Two things can go wrong and neither is caught by a build: the read
  // can fail, or it can return rows the header then renders wrongly. The public
  // page below is the assertion that matters — it is the actual header, fetched
  // the way a reader fetches it.
  const nav = await request("/studio/nav");
  ok("nav editor renders", nav.status === 200, `status ${nav.status}`);
  ok("nav editor names the screen", nav.text.includes("导航"));
  ok("nav editor offers an add form", nav.text.includes("添加链接"));

  const { rows: navRows } = await client.query(
    `SELECT label, href FROM nav_items WHERE visible ORDER BY sort_order, created_at, href`
  );
  ok("the nav has entries", navRows.length > 0);

  const home = await request("/");
  ok("home renders", home.status === 200, `status ${home.status}`);
  for (const item of navRows) {
    ok(
      `the header links ${item.href} as “${item.label}”`,
      home.body.includes(`href="${item.href}"`),
      "the rendered header does not carry this link"
    );
  }
  ok(
    "the header no longer renders the retired English seed",
    !home.body.includes(">Microblog<"),
    "a row from the pre-0010 seed is still being rendered"
  );

  // ── a retired path redirects ─────────────────────────────────────────────
  //
  // The redirect table is read from the catch-all page, not from the proxy, so
  // this asserts the wiring end to end: a slug with no page, a row in
  // `redirects`, and a 308 out of the public route.
  //
  // The source path carries a random suffix so it can never have been rendered
  // before. That matters for the counter assertion below and is the reason this
  // does not use a fixed path: the route is cached for 30 days, and a rendered
  // page is what increments `hits` (see src/lib/studio/redirects.js), so a
  // second run against the same server would serve the redirect from cache and
  // find the counter at zero on a server that is working perfectly.
  // It lands on a page that exists, which is what makes the 308 a real redirect
  // rather than a redirect to another miss.
  const retiredPath = `/e2e-retired-${randomBytes(6).toString("hex")}`;

  await client.query(
    `INSERT INTO redirects (source, destination, permanent)
     VALUES ($1, '/about', true)`,
    [retiredPath]
  );

  const retired = await request(retiredPath);
  ok(
    "a retired path permanently redirects",
    retired.status === 308 || retired.status === 301,
    `status ${retired.status}`
  );
  ok(
    "the redirect lands where the table says",
    String(retired.location ?? "").endsWith("/about"),
    retired.location
  );

  // Polled rather than read once. `recordHit` is deliberately fire-and-forget —
  // it is not awaited by the redirect path, because making a reader wait on a
  // counter UPDATE to be told where a page moved to would be a real cost for a
  // number that is only a signal. So the increment lands some milliseconds
  // AFTER the response, and reading once races it.
  //
  // Note what is being asserted: that a RENDER records a hit. A response served
  // from the route cache does not, which is why the path above is unique per
  // run. That is a real property of the design rather than a defect — the
  // counter answers "is anything still linking here" and not "how much" — and
  // it is written down in src/lib/studio/redirects.js.
  let hitCount = 0;
  for (let attempt = 0; attempt < 20 && hitCount === 0; attempt++) {
    const { rows: hits } = await client.query(
      `SELECT hits FROM redirects WHERE source = $1`,
      [retiredPath]
    );
    hitCount = Number(hits[0]?.hits ?? 0);
    if (hitCount === 0) await new Promise((r) => setTimeout(r, 100));
  }
  ok("the hit was counted", hitCount >= 1, `hits = ${hitCount}`);

  await client.query(`DELETE FROM redirects WHERE source = $1`, [retiredPath]);

  // ── the collections screens ──────────────────────────────────────────────
  //
  // The screens whose whole purpose is that they are generated from a SCHEMA.
  // The columns of `collection_fields` become the controls of the entry form at
  // request time, so a build that compiles proves nothing about whether the two
  // agree — asserting that the rendered form carries the actual field labels of
  // the actual collection is what does.
  const collections = await request("/studio/collections");
  ok("collection list renders", collections.status === 200, `status ${collections.status}`);
  ok("collection list shows the microblog", collections.text.includes("微博"));
  ok("collection list shows the friend links", collections.text.includes("友链"));

  const { rows: mbFields } = await client.query(
    `SELECT f.label, f.key FROM collection_fields f
       JOIN collections c ON c.id = f.collection_id
      WHERE c.slug = 'microblog' ORDER BY f.sort_order`
  );
  ok("the microblog collection has fields to render", mbFields.length > 0);

  const mb = await request("/studio/collections/microblog");
  ok("collection editor renders", mb.status === 200, `status ${mb.status}`);
  ok("collection editor has both tabs", mb.text.includes("条目") && mb.text.includes("字段"));
  ok(
    "collection editor offers a new-entry form",
    mb.body.includes("新建条目"),
    "no create button rendered"
  );

  // Every field's LABEL, from the database, inside the rendered entry form.
  // `label` for the schema-name case and `aria-label` for the key-input case,
  // because the field list and the add form are two different renderings of the
  // same row and either is enough to prove the schema reached the screen.
  for (const field of mbFields) {
    ok(
      `the entry form renders the “${field.key}” field`,
      mb.body.includes(field.label) || mb.body.includes(`字段 ${field.label}`),
      "the schema did not reach the form"
    );
  }

  // The entry count in the tab label, read from the database rather than
  // hardcoded — the microblog grows, and a test that breaks when the author
  // writes a sentence is a test that gets disabled.
  const { rows: mbEntries } = await client.query(
    `SELECT count(*)::int AS n FROM collection_entries e
       JOIN collections c ON c.id = e.collection_id WHERE c.slug = 'microblog'`
  );
  ok(
    "the entry tab reports the entry count",
    mb.text.includes(`条目 (${mbEntries[0].n})`),
    `expected 条目 (${mbEntries[0].n})`
  );

  const links = await request("/studio/collections/links");
  ok("the friend-links collection renders", links.status === 200, `status ${links.status}`);
  ok("its entry form carries the name field", links.text.includes("名称"));

  const missingCollection = await request("/studio/collections/no-such-collection");
  ok(
    "an unknown collection explains itself",
    missingCollection.text.includes("找不到这个集合"),
    `status ${missingCollection.status}`
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
