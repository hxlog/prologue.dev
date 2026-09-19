/**
 * Does the browser's presigned PUT work cross-origin?
 *
 * The probe proved the presigned URL accepts a PUT from Node — but Node does not
 * enforce CORS, so that says nothing about a browser. The upload design hinges
 * on this: if `https://vercel.com/api/blob/…` does not preflight, the browser
 * cannot PUT there and the whole client-upload approach has to be replaced with
 * a server-side `put()` that streams multi-megabyte images through a function.
 *
 * Two checks, because they fail independently:
 *   - OPTIONS preflight (what the browser sends before a PUT with a
 *     `content-type` header that is not CORS-safelisted)
 *   - the real PUT echoed back with an `Origin`, whose response must carry
 *     `access-control-allow-origin` or the browser discards the result
 *
 * Run: node --env-file=.env.local scripts/studio/blob-cors-probe.mjs
 */

import { put, del, issueSignedToken, presignUrl } from "@vercel/blob";

const ORIGIN = "https://prologue.dev";
const name = `media/cors-${Date.now().toString(36)}.txt`;

async function signed() {
  const token = await issueSignedToken({
    pathname: name,
    operations: ["put"],
    allowedContentTypes: ["text/plain"],
    maximumSizeInBytes: 1024,
    validUntil: Date.now() + 120_000,
  });
  const { presignedUrl } = await presignUrl(token, {
    operation: "put",
    pathname: name,
    access: "private",
    allowedContentTypes: ["text/plain"],
    maximumSizeInBytes: 1024,
    allowOverwrite: true,
  });
  return presignedUrl;
}

// A real object first, so a failed PUT is not just "the blob did not exist".
await put(name, "seed", { access: "private", contentType: "text/plain", addRandomSuffix: false });

try {
  const url = new URL(await signed());
  console.log("presigned host:", url.host, url.pathname);

  const preflight = await fetch(url, {
    method: "OPTIONS",
    headers: {
      origin: ORIGIN,
      "access-control-request-method": "PUT",
      "access-control-request-headers": "content-type",
    },
  });
  console.log(
    "OPTIONS  ->",
    preflight.status,
    "allow-origin:",
    preflight.headers.get("access-control-allow-origin") ?? "(none)",
    "| allow-methods:",
    preflight.headers.get("access-control-allow-methods") ?? "(none)",
    "| allow-headers:",
    preflight.headers.get("access-control-allow-headers") ?? "(none)"
  );

  const res = await fetch(url, {
    method: "PUT",
    body: "cors probe",
    headers: { "content-type": "text/plain", origin: ORIGIN },
  });
  console.log(
    "PUT      ->",
    res.status,
    "allow-origin:",
    res.headers.get("access-control-allow-origin") ?? "(none)"
  );

  const readable = res.headers.get("access-control-allow-origin");
  console.log(
    "\nVERDICT:",
    readable ? "BROWSER PUT WILL WORK" : "BROWSER PUT WILL BE BLOCKED — needs a server-side upload"
  );
} catch (err) {
  console.log("probe threw:", err.name, err.message);
} finally {
  await del(name).catch((e) => console.log("cleanup failed:", e.message));
}
