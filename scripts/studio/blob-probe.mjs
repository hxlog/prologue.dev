/**
 * Probe the Blob store before building the media library on it.
 *
 * Four questions, each of which changes the design if the answer is not what
 * the SDK's types say:
 *
 *   1. Does the read-write token still authenticate? (It was pasted in plaintext
 *      at some point; if it has been rotated this fails here rather than four
 *      files into the feature.)
 *   2. Is the store PRIVATE? `access: 'private'` is a per-call argument, so a
 *      public store would accept it and serve the object unauthenticated anyway.
 *      The only way to know is to ask for the object back without credentials.
 *   3. Does `issueSignedToken` + `presignUrl` produce a PUT that actually works?
 *      That is the whole upload path.
 *   4. Can `get()` stream an object back? That is the whole read path.
 *
 * Run:
 *   node --env-file=.env.local scripts/studio/blob-probe.mjs
 */

import { put, get, list, del, issueSignedToken, presignUrl } from "@vercel/blob";

const name = `media/probe-${Date.now().toString(36)}.txt`;
const body = "prologue blob probe";

function line(label, value) {
  console.log(`${label.padEnd(34)} ${value}`);
}

console.log("token set:", Boolean(process.env.BLOB_READ_WRITE_TOKEN));
console.log("store id :", process.env.BLOB_STORE_ID ? "set" : "(unset)");
console.log("");

// 1 + 2: store access, and whether a token works at all.
try {
  const listing = await list({ limit: 5 });
  line("list(): ok", `${listing.blobs.length} existing blob(s)`);
} catch (err) {
  line("list(): FAILED", `${err.name}: ${err.message}`);
}

// 3: the upload path, server-side `put` first.
let uploaded = null;
try {
  uploaded = await put(name, body, {
    access: "private",
    contentType: "text/plain",
    addRandomSuffix: false,
  });
  line("put(private): ok", uploaded.url.slice(0, 72) + "…");
} catch (err) {
  line("put(private): FAILED", `${err.name}: ${err.message}`);
}

// Is it actually private? Fetch the raw URL with NO credentials.
if (uploaded) {
  try {
    const res = await fetch(uploaded.url);
    line(
      "raw URL, no credentials",
      res.status === 200
        ? `200 — THE STORE IS PUBLIC, access:'private' is being ignored`
        : `${res.status} — private as expected`
    );
  } catch (err) {
    line("raw URL, no credentials", `threw: ${err.message}`);
  }
}

// 4: the read path.
if (uploaded) {
  try {
    const result = await get(uploaded.pathname, { access: "private" });
    const text = result?.stream ? await new Response(result.stream).text() : "(no stream)";
    line("get(private): ok", `${result?.statusCode} ${JSON.stringify(text)}`);
  } catch (err) {
    line("get(private): FAILED", `${err.name}: ${err.message}`);
  }
}

// 5: the presigned PUT that the browser will actually use.
try {
  const signed = await issueSignedToken({
    pathname: name,
    operations: ["put"],
    allowedContentTypes: ["text/plain"],
    maximumSizeInBytes: 1024,
    validUntil: Date.now() + 60_000,
  });
  line("issueSignedToken(): ok", `valid until ${new Date(signed.validUntil).toISOString()}`);

  const { presignedUrl } = await presignUrl(signed, {
    operation: "put",
    pathname: name,
    access: "private",
    allowedContentTypes: ["text/plain"],
    maximumSizeInBytes: 1024,
    allowOverwrite: true,
  });
  line("presignUrl(): ok", presignedUrl.slice(0, 72) + "…");

  const res = await fetch(presignedUrl, {
    method: "PUT",
    body: "presigned probe",
    headers: { "content-type": "text/plain" },
  });
  line("PUT to presigned URL", `${res.status} ${res.statusText}`);

  if (res.ok) {
    const back = await get(name, { access: "private" });
    const text = back?.stream ? await new Response(back.stream).text() : "(no stream)";
    line("read back after presign", JSON.stringify(text));
  }
} catch (err) {
  line("presigned flow: FAILED", `${err.name}: ${err.message}`);
}

// Clean up. The store is real and this is somebody's storage.
try {
  await del(name);
  line("del(): cleaned up", name);
} catch (err) {
  line("del(): FAILED — left behind", `${name}: ${err.message}`);
}
