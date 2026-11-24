/**
 * Content reads shared by pages, feeds and the search index.
 *
 * Cache Components ("use cache" + cacheLife) cannot be used with static export
 * (Next 16 rejects PPR in export mode), so the same build-time guarantee is
 * kept with a module-level production-only memo: during "next build" every
 * slug is rendered once and reused by the page, the feeds and the search
 * index. In development the memo is off, so editing markdown still reloads
 * through the loader's mtime signature.
 */
import "server-only";
import { getPosts, getPages, getBodyHtml } from "./index.js";

const MEMO = process.env.NODE_ENV === "production";

function toMeta({ body, ...meta }) {
  return meta;
}

let postsMemo = null;
export async function getCachedPosts() {
  if (MEMO && postsMemo) return postsMemo;
  const posts = getPosts().map(toMeta);
  if (MEMO) postsMemo = posts;
  return posts;
}

const postMemo = new Map();
export async function getCachedPost(slug) {
  if (MEMO && postMemo.has(slug)) return postMemo.get(slug);
  const promise = (async () => {
    const doc = getPosts().find((post) => post.slugAsParams === slug);
    if (!doc) return null;
    return { ...toMeta(doc), html: await getBodyHtml(doc) };
  })();
  if (MEMO) postMemo.set(slug, promise);
  return promise;
}

const pageMemo = new Map();
export async function getCachedPage(slug) {
  if (MEMO && pageMemo.has(slug)) return pageMemo.get(slug);
  const promise = (async () => {
    const doc = getPages().find((page) => page.slugAsParams === slug);
    if (!doc) return null;
    return { ...toMeta(doc), html: await getBodyHtml(doc) };
  })();
  if (MEMO) pageMemo.set(slug, promise);
  return promise;
}
