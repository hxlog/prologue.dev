/**
 * Does the presigned PUT actually enforce what the signature says?
 *
 * "The constraint is in the signature" is a claim about a third-party CDN, and
 * it is the claim this whole upload path rests on: the client holds the URL, the
 * bytes never pass through a function, and nothing here can inspect what was
 * sent. So the claim gets tested.
 *
 * ## What it found, on 2.8.0 against the real store
 *
 *   addRandomSuffix, put()          kept the pathname — default is FALSE
 *   addRandomSuffix, presignUrl()   kept the pathname — default is FALSE
 *   PUT to a swapped pathname       403 — the path is in the signed query
 *   PUT over maximumSizeInBytes     403
 *   PUT with a disallowed type      200, and the object is stored with the type
 *                                   the SIGNATURE declared, not the one sent
 *
 * The first two settle a disagreement rather than answering an open question:
 * src/lib/media/blob.js used to assert the default was TRUE, citing a probe
 * whose failure does not reproduce. The value is still set explicitly at every
 * call site — a default is not a promise — but the comment now records what was
 * measured instead of a story about it.
 *
 * The last row is the one that is easy to misread. The content-type constraint
 * is enforced by OVERWRITING, not by refusing. That is the safe half of the two
 * options and it is not the half a reader would assume, which is why
 * `commitUpload` re-reads the type with `head()` and the proxy sends `nosniff`.
 *
 * Run: node --env-file=.env.local scripts/studio/blob-signing-probe.mjs
 * Requires a live store; it writes seven small objects and sweeps them.
 */

import { put, del, list, issueSignedToken, presignUrl, head } from "@vercel/blob";

const stamp = Date.now().toString(36);
const results = [];

function line(label, value) {
  results.push(`${label.padEnd(46)} ${value}`);
  console.log(`${label.padEnd(46)} ${value}`);
}

const cleanup = [];

// ── 1. the default, server-side put ──────────────────────────────────────────
{
  const wanted = `media/probe-${stamp}-putdefault.txt`;
  const result = await put(wanted, "x", {
    access: "private",
    contentType: "text/plain",
    // NO addRandomSuffix — this is the question.
  });
  cleanup.push(result.pathname);
  line(
    "put() with no addRandomSuffix",
    result.pathname === wanted
      ? "kept the pathname exactly — default is FALSE"
      : `APPENDED: ${result.pathname}`
  );
}

// ── 1b. the default, presigned put ───────────────────────────────────────────
{
  const wanted = `media/probe-${stamp}-presigndefault.txt`;
  const token = await issueSignedToken({
    pathname: wanted,
    operations: ["put"],
    allowedContentTypes: ["text/plain"],
    maximumSizeInBytes: 4096,
    validUntil: Date.now() + 60_000,
  });
  const { presignedUrl } = await presignUrl(token, {
    operation: "put",
    pathname: wanted,
    access: "private",
    // NO addRandomSuffix — this is the question.
  });

  const res = await fetch(presignedUrl, {
    method: "PUT",
    body: "x",
    headers: { "content-type": "text/plain" },
  });
  const body = await res.json().catch(() => ({}));
  const landed = body.pathname ?? "(none)";
  if (landed !== "(none)") cleanup.push(landed);

  line(
    "presignUrl() with no addRandomSuffix",
    landed === wanted ? "kept the pathname exactly — default is FALSE" : `APPENDED: ${landed}`
  );
}

// ── 2. can the pathname be swapped? ──────────────────────────────────────────
//
// The signature covers the canonical query, which includes the pathname, so this
// SHOULD fail. If it does not, a client holding a ticket for one pathname can
// write an arbitrary object into the store — which is the difference between a
// ticket and a skeleton key.
{
  const mine = `media/probe-${stamp}-mine.txt`;
  const theirs = `media/probe-${stamp}-theirs.txt`;

  const token = await issueSignedToken({
    pathname: mine,
    operations: ["put"],
    allowedContentTypes: ["text/plain"],
    maximumSizeInBytes: 4096,
    validUntil: Date.now() + 60_000,
  });
  const { presignedUrl } = await presignUrl(token, {
    operation: "put",
    pathname: mine,
    access: "private",
    addRandomSuffix: false,
  });

  const tampered = presignedUrl.replace(encodeURIComponent(mine), encodeURIComponent(theirs));
  const swapped = tampered !== presignedUrl;

  if (!swapped) {
    line("pathname swap", "the URL does not contain the pathname literally — inconclusive");
  } else {
    const res = await fetch(tampered, {
      method: "PUT",
      body: "x",
      headers: { "content-type": "text/plain" },
    });
    line(
      "PUT to a swapped pathname",
      res.ok ? `ACCEPTED (${res.status}) — the signature does not pin the path` : `refused (${res.status})`
    );
    cleanup.push(theirs, mine);
  }
}

// ── 3. can the content type be beaten? ───────────────────────────────────────
//
// The interesting half is not the status code. A 200 here is not a hole: what
// matters is what the object's stored type IS afterwards, because that is what
// every later reader sees. Tested by asking the store, with head() and get(),
// rather than by trusting the response body.
{
  const name = `media/probe-${stamp}-type.txt`;
  const token = await issueSignedToken({
    pathname: name,
    operations: ["put"],
    allowedContentTypes: ["text/plain"],
    maximumSizeInBytes: 4096,
    validUntil: Date.now() + 60_000,
  });
  const { presignedUrl } = await presignUrl(token, {
    operation: "put",
    pathname: name,
    access: "private",
    allowedContentTypes: ["text/plain"],
    maximumSizeInBytes: 4096,
    addRandomSuffix: false,
  });

  const res = await fetch(presignedUrl, {
    method: "PUT",
    body: "<svg onload=alert(1)>",
    headers: { "content-type": "image/svg+xml" },
  });

  const stored = await head(name).catch(() => null);
  const landedType = stored?.contentType ?? null;

  line(
    `PUT with a disallowed type`,
    res.ok
      ? `ACCEPTED (${res.status}) — stored as ${JSON.stringify(landedType)}` +
          (landedType === "text/plain" ? ", the SIGNED type" : " — NOT THE SIGNED TYPE")
      : `refused (${res.status})`
  );
  cleanup.push(name);
}

// ── 4. can the size limit be beaten? ─────────────────────────────────────────
{
  const name = `media/probe-${stamp}-size.txt`;
  const token = await issueSignedToken({
    pathname: name,
    operations: ["put"],
    allowedContentTypes: ["text/plain"],
    maximumSizeInBytes: 1024,
    validUntil: Date.now() + 60_000,
  });
  const { presignedUrl } = await presignUrl(token, {
    operation: "put",
    pathname: name,
    access: "private",
    allowedContentTypes: ["text/plain"],
    maximumSizeInBytes: 1024,
    addRandomSuffix: false,
  });

  const res = await fetch(presignedUrl, {
    method: "PUT",
    body: "x".repeat(4096),
    headers: { "content-type": "text/plain" },
  });
  line(
    "PUT larger than maximumSizeInBytes",
    res.ok ? `ACCEPTED (${res.status}) — the size is not pinned` : `refused (${res.status})`
  );
  cleanup.push(name);
}

// ── clean up ─────────────────────────────────────────────────────────────────
let removed = 0;
for (const pathname of new Set(cleanup)) {
  // A pathname that was suffixed at storage time is not in `cleanup`; sweep the
  // probe prefix as a backstop so nothing is left in a real store.
  try {
    await del(pathname);
    removed++;
  } catch {
    /* already gone */
  }
}

const { blobs } = await list({ prefix: `media/probe-${stamp}` });
for (const blob of blobs) {
  await del(blob.pathname).catch(() => {});
  removed++;
}
line("cleaned up", `${removed} object(s)`);

const { blobs: leftover } = await list({ prefix: `media/probe-${stamp}` });
if (leftover.length) {
  console.log(`\n!! ${leftover.length} probe object(s) left behind:`);
  for (const b of leftover) console.log(`   ${b.pathname}`);
}
