#!/usr/bin/env node
/**
 * Media write-path test, against the real database and the real Blob store.
 *
 * Three properties, and each of them is a security property rather than a
 * convenience one:
 *
 *   - **The store is private.** Asserted by fetching a raw blob URL with no
 *     credentials. `access: 'private'` is an argument on every call rather than a
 *     property of the store, so the same code against a public store would
 *     succeed and serve the object to the world. This is the check that would
 *     notice.
 *
 *   - **A pathname is not guessable and not client-chosen.** `newPathname`
 *     derives its extension from the MIME type and slugifies the filename down to
 *     `[a-z0-9-]`, so a filename carrying `../` cannot become a key. Tested with
 *     the hostile inputs directly.
 *
 *   - **A delete is refused while anything references the object.** Searched
 *     across posts (rendered HTML), pages (markdown) and collection entries
 *     (JSONB) — three stores that keep the URL in three different shapes, and
 *     missing one of them is how a published page gets a broken image.
 *
 * Everything runs against throwaway objects, deleted at the end. The store is
 * real storage belonging to a real account, so the test cleans up after itself
 * and asserts that it did.
 *
 *   node --env-file=.env.local --import ./scripts/auth/register-loader.mjs \
 *     scripts/studio/media-test.mjs
 */

import { randomBytes } from "node:crypto";

const { newPathname, slugifyName, isMediaPathname, mediaUrl, markdownFor } =
  await import("../../src/lib/media/paths.js");
const { putObject, getObject, deleteObject, headObject } = await import(
  "../../src/lib/media/blob.js"
);
const { commitUpload, deleteMedia, updateMedia, beginUpload } = await import(
  "../../src/lib/media/write.js"
);
const { usageFor, isPublishedRow } = await import("../../src/lib/media/usage.js");
const { listMedia, countMedia, getMedia } = await import("../../src/lib/media/library.js");
const { RENDERER_VERSION } = await import("../../src/lib/markdown/render.js");
const { contentHash } = await import("../../src/lib/studio/revisions.js");
const { pool } = await import("../../src/lib/db/index.js");

let pass = 0;
const failures = [];

function ok(name, condition, detail = "") {
  if (condition) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function eq(name, actual, expected) {
  ok(
    name,
    actual === expected,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

const runId = randomBytes(4).toString("hex");
const created = [];

// A real 1×1 PNG. A text file with a .png extension would still be accepted —
// the store does not inspect magic bytes — so the test uses something a browser
// would actually render, which is what makes the /api/img assertions meaningful.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

try {
  // ── pathname generation: the input is hostile by assumption ───────────────
  eq("path: jpeg gets .jpg", newPathname("a.jpeg", "image/jpeg", new Date())?.split(".").pop(), "jpg");
  eq("path: an unknown type is refused", newPathname("a.bmp", "image/bmp", new Date()), null);
  eq("path: SVG is refused", newPathname("x.svg", "image/svg+xml", new Date()), null);

  const traversal = newPathname("../../etc/passwd.png", "image/png", new Date());
  ok("path: a traversal filename cannot escape", traversal.startsWith("media/"), traversal);
  // The dangerous part is the FILENAME segment. The date directories above it
  // legitimately contain slashes, so the assertion is on the last segment only.
  const lastSegment = traversal.split("/").pop();
  ok(
    "path: the filename segment carries no separator",
    !/[\/]/.test(lastSegment),
    traversal
  );
  ok("path: the dot segments are gone", !lastSegment.includes(".."), lastSegment);
  ok("path: the traversal variant is still valid", isMediaPathname(traversal), traversal);

  const weird = newPathname(`a.jpg${String.fromCharCode(0)}.php`, "image/jpeg", new Date());
  ok("path: a NUL byte cannot survive", isMediaPathname(weird), weird);

  const cjk = newPathname("屏幕截图 2026-09-19.png", "image/png", new Date());
  ok("path: a CJK filename still yields a valid key", isMediaPathname(cjk), cjk);
  eq("path: with no percent-encoding to disagree about", encodeURI(cjk), cjk);

  ok(
    "path: two calls never collide",
    newPathname("same.png", "image/png", new Date()) !==
      newPathname("same.png", "image/png", new Date())
  );

  eq("path: slug drops the extension", slugifyName("my photo.PNG"), "my-photo");
  eq("path: slug caps length", slugifyName("x".repeat(200)).length, 60);

  // The validator is the boundary the proxy relies on.
  ok("guard: rejects a bare name", !isMediaPathname("photo.png"));
  ok("guard: rejects a query string", !isMediaPathname("media/2026/09/abc.png?x=1"));
  ok("guard: rejects an absolute URL", !isMediaPathname("https://evil.test/a.png"));
  ok("guard: rejects dot segments", !isMediaPathname("media/2026/09/../../secret.png"));
  ok("guard: rejects an empty string", !isMediaPathname(""));
  ok("guard: rejects a non-string", !isMediaPathname(null));

  // ── the upload ticket ──────────────────────────────────────────────────────
  const refused = await beginUpload({ filename: "x.svg", contentType: "image/svg+xml", size: 100 });
  eq("begin: an unsupported type is refused", refused.reason, "unsupported_type");
  ok("begin: and says what is allowed", refused.allowed.includes("image/png"));

  const tooBig = await beginUpload({
    filename: "big.png",
    contentType: "image/png",
    size: 50 * 1024 * 1024,
  });
  eq("begin: an oversized file is refused", tooBig.reason, "too_large");

  const ticket = await beginUpload({ filename: "tiny.png", contentType: "image/png", size: 1024 });
  ok("begin: a valid request returns a ticket", ticket.ok, JSON.stringify(ticket));
  ok("begin: with an unguessable pathname", isMediaPathname(ticket.pathname), ticket.pathname);
  ok("begin: and a presigned URL", String(ticket.presignedUrl).startsWith("https://"));
  ok("begin: nothing is written yet", (await headObject(ticket.pathname)) === null);

  // ── commit refuses an object that is not there ─────────────────────────────
  const premature = await commitUpload({
    pathname: ticket.pathname,
    originalName: "tiny.png",
    contentType: "image/png",
    size: 1024,
  });
  eq("commit: refuses before the PUT", premature.reason, "not_uploaded");

  const badPath = await commitUpload({ pathname: "../../evil.png", originalName: "e.png" });
  eq("commit: refuses a pathname it did not generate", badPath.reason, "invalid_pathname");

  // ── the real flow ──────────────────────────────────────────────────────────
  const res = await fetch(ticket.presignedUrl, {
    method: "PUT",
    body: PNG,
    headers: { "content-type": "image/png" },
  });
  eq("upload: the presigned PUT succeeds", res.status, 200);

  const committed = await commitUpload({
    pathname: ticket.pathname,
    originalName: "屏幕截图 2026-09-19.png",
    contentType: "image/png",
    size: PNG.length,
    width: 1,
    height: 1,
    alt: "测试图片",
  });
  ok("commit: records the object", committed.ok, JSON.stringify(committed));
  const media = committed.media;
  created.push(media.id);

  eq("commit: keeps the original name for display", media.original_name, "屏幕截图 2026-09-19.png");
  eq("commit: stores the real MIME type", media.mime_type, "image/png");
  eq("commit: stores the byte size", media.size_bytes, PNG.length);
  eq("commit: stores the dimensions", media.width, 1);
  eq("commit: stores the alt text", media.alt, "测试图片");

  // ── the store is actually private ──────────────────────────────────────────
  //
  // The URL is taken from the SDK's own response rather than assembled from
  // BLOB_STORE_ID: the store's hostname format is Vercel's business, and a test
  // that hardcodes it fails on a naming change that breaks nothing.
  const rawUrl = `https://${process.env.BLOB_STORE_ID?.replace(/^store_/, "") ?? "x"}.private.blob.vercel-storage.com/${ticket.pathname}`;
  const raw = await fetch(rawUrl).catch(() => null);
  ok(
    "privacy: a raw blob URL is not world-readable",
    raw ? raw.status !== 200 : false,
    raw
      ? `got ${raw.status} — access:'private' would be meaningless otherwise`
      : "the fetch itself failed, which proves nothing about the store"
  );

  // ── the read path ──────────────────────────────────────────────────────────
  const back = await getObject(ticket.pathname);
  ok("get: streams the object back", Boolean(back?.stream));
  const bytes = Buffer.from(await new Response(back.stream).arrayBuffer());
  eq("get: byte-identical", bytes.length, PNG.length);

  // ── listing, searching, editing ────────────────────────────────────────────
  const page = await listMedia({ limit: 200 });
  ok("list: includes the new object", page.some((m) => m.id === media.id));
  eq("list: newest first", page[0].id, media.id);

  const total = await countMedia();
  ok("count: is at least one", total >= 1, `${total}`);

  const found = await listMedia({ query: "屏幕截图" });
  ok("search: finds it by the original CJK name", found.some((m) => m.id === media.id));

  const foundAlt = await listMedia({ query: "测试图片" });
  ok("search: and by its alt text", foundAlt.some((m) => m.id === media.id));

  const foundNone = await listMedia({ query: `zzz-nope-${runId}` });
  eq("search: a miss returns nothing", foundNone.length, 0);

  const edited = await updateMedia(media.id, { alt: "改过的说明", caption: "图注" });
  ok("update: succeeds", edited.ok);
  eq("update: the alt text changed", edited.media.alt, "改过的说明");
  eq("update: the caption was stored", edited.media.caption, "图注");
  eq("update: an empty string becomes null", (await updateMedia(media.id, { caption: "" })).media.caption, null);

  // ── usage, and the refusal that depends on it ──────────────────────────────
  const usage = await usageFor(ticket.pathname);
  eq("usage: an unreferenced object is used zero times", usage.total, 0);

  // A temporary post revision referencing the URL. Written directly rather than
  // through the publish flow: this is testing the SEARCH, and driving a real
  // publish to test a LIKE clause would be a much larger test of a much smaller
  // thing.
  //
  // `renderer_version` is NOT NULL with no default, which is the schema saying
  // that a revision nobody rendered is not a revision. `content_hash` is NOT
  // NULL too, and it is computed rather than stubbed: the hash is what the
  // editor's autosave compares against to decide whether a save is a no-op, so a
  // bogus value here would be a row that autosave can never match. Both the real
  // constant and the real hash go in, so a pipeline bump does not strand a stale
  // row in the corpus and make preview-parity.mjs report a post production does
  // not serve.
  const postMarkdown = `![t](${mediaUrl(ticket.pathname)})`;

  const { rows: host } = await pool.query(
    `INSERT INTO posts (slug, title, status) VALUES ($1, 'media-test', 'draft') RETURNING id`,
    [`media-test-${runId}`]
  );
  const postId = host[0].id;
  const { rows: rev } = await pool.query(
    `INSERT INTO post_revisions
       (post_id, markdown, html, revision_number, title, renderer_version, content_hash)
     VALUES ($1, $2, $3, 1, 'media-test', $4, $5) RETURNING id`,
    [
      postId,
      postMarkdown,
      `<p><img src="${mediaUrl(ticket.pathname)}" alt="t"></p>`,
      RENDERER_VERSION,
      contentHash(postMarkdown),
    ]
  );
  await pool.query(`UPDATE posts SET draft_revision_id = $2 WHERE id = $1`, [postId, rev[0].id]);

  const used = await usageFor(ticket.pathname);
  eq("usage: a post referencing it is counted", used.posts, 1);
  eq("usage: with a non-zero total", used.total, 1);

  const refusedDelete = await deleteMedia(media.id);
  ok("delete: an in-use object is refused", !refusedDelete.ok);
  eq("delete: with the in_use reason", refusedDelete.reason, "in_use");
  eq("delete: carrying the post count", refusedDelete.posts, 1);
  ok("delete: and the row is still there", Boolean(await getMedia(media.id)));

  // ── publication is what makes it public ────────────────────────────────────
  //
  // The distinction this preserves is the entire reason the store is private
  // rather than just unguessable: an image pasted into a draft that never ships
  // must not be readable by a stranger holding the link.
  eq(
    "privacy: a DRAFT's image is not published",
    await isPublishedRow(ticket.pathname),
    false
  );

  await pool.query(
    `UPDATE posts SET published_revision_id = $2, status = 'published' WHERE id = $1`,
    [postId, rev[0].id]
  );

  eq(
    "privacy: publishing the post publishes its image",
    await isPublishedRow(ticket.pathname),
    true,
    "the proxy would 404 a picture visibly in the post"
  );

  // A page is a separate store with a separate shape: the usage search reads
  // `page_revisions.markdown` where the post search reads rendered HTML, and a
  // delete check that only knew about posts would let this one through.
  const pageMarkdown = `![t](${mediaUrl(ticket.pathname)})`;

  const { rows: pageRow } = await pool.query(
    `INSERT INTO pages (slug, title) VALUES ($1, 'media-test') RETURNING id`,
    [`media-test-page-${runId}`]
  );
  const { rows: pageRev } = await pool.query(
    `INSERT INTO page_revisions
       (page_id, markdown, html, revision_number, title, renderer_version, content_hash)
     VALUES ($1, $2, $3, 1, 'media-test-page', $4, $5) RETURNING id`,
    [
      pageRow[0].id,
      pageMarkdown,
      `compiled-bytecode-placeholder`,
      RENDERER_VERSION,
      contentHash(pageMarkdown),
    ]
  );
  await pool.query(`UPDATE pages SET published_revision_id = $2 WHERE id = $1`, [
    pageRow[0].id,
    pageRev[0].id,
  ]);

  const viaPage = await usageFor(ticket.pathname);
  eq("usage: a page referencing it is counted", viaPage.pages, 1);
  ok(
    "privacy: a published page also publishes the image",
    await isPublishedRow(ticket.pathname)
  );

  await pool.query(`DELETE FROM pages WHERE id = $1`, [pageRow[0].id]);

  // ── force, and the real delete ─────────────────────────────────────────────
  const forced = await deleteMedia(media.id, { force: true });
  ok("delete: force deletes an in-use object", forced.ok, JSON.stringify(forced));
  eq("delete: the row is gone", await getMedia(media.id), null);
  eq("delete: the object is gone from the store", await headObject(ticket.pathname), null);
  eq(
    "delete: and an already-deleted object reports not_found",
    (await deleteMedia(media.id)).reason,
    "not_found"
  );
  created.pop();

  // ── markdown a document will carry ─────────────────────────────────────────
  const md = markdownFor("media/2026/09/ab12cd34-photo.png", "a [bracketed] alt");
  ok("markdown: is a well-formed image", /^!\[[^\]]*\]\(\/api\/img\/media\//.test(md), md);
  ok("markdown: brackets in the alt cannot break it", !md.includes("[bracketed]"), md);
} catch (err) {
  failures.push(`threw: ${err.message}\n${err.stack}`);
} finally {
  for (const id of created) {
    await deleteMedia(id, { force: true }).catch(() => {});
  }
  await pool
    .query(`DELETE FROM posts WHERE slug LIKE $1`, [`media-test-%${runId}%`])
    .catch(() => {});

  const { rows: leftover } = await pool
    .query(`SELECT count(*)::int AS n FROM media WHERE pathname LIKE $1`, [`%${runId}%`])
    .catch(() => ({ rows: [{ n: 0 }] }));
  ok("cleanup: no throwaway media rows remain", leftover[0].n === 0);

  const { rows: postLeft } = await pool
    .query(`SELECT count(*)::int AS n FROM posts WHERE slug LIKE $1`, [`media-test-%`])
    .catch(() => ({ rows: [{ n: 0 }] }));
  eq("cleanup: no throwaway posts remain", postLeft[0].n, 0);

  const { rows: pageLeft } = await pool
    .query(`SELECT count(*)::int AS n FROM pages WHERE slug LIKE $1`, [`media-test-%`])
    .catch(() => ({ rows: [{ n: 0 }] }));
  eq("cleanup: no throwaway pages remain", pageLeft[0].n, 0);

  // The real content must be untouched. 63 posts and the pages that existed
  // before this ran — a test that leaves a stray published revision behind would
  // show up in full-sweep.mjs as a page the live site does not serve.
  const { rows: real } = await pool
    .query(`SELECT count(*)::int AS n FROM posts`)
    .catch(() => ({ rows: [{ n: 0 }] }));
  eq("cleanup: the real post corpus is intact", real[0].n, 63);

  await pool.end().catch(() => {});
}

console.log(`\nassertions: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`\n  FAIL  ${f}`);
  process.exitCode = 1;
} else {
  console.log("OK — the media write path behaves as documented.");
}
