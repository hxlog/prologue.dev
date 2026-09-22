/**
 * The site's content API -- the drop-in replacement for `contentlayer/generated`.
 *
 * The `server-only` guard is HERE and only here. It is what stops a Client
 * Component from pulling the filesystem in; the bundler resolves the
 * `react-server` condition for the RSC graph and rejects the import otherwise.
 * load.js / pipeline.js / slug.js deliberately do not carry it, so a plain
 * `node scripts/...` can import them (see scripts/check-render-equivalence.mjs).
 *
 * THE EXPORTS ARE FUNCTIONS, NOT ARRAYS, AND THE NAME SAYS SO. Contentlayer2
 * offered `allPosts` / `allPages` as module constants. This loader cannot
 * honestly do that: the markdown is read with fs, which no bundler watches, so
 * a constant would freeze the first read and keep serving it after every edit
 * (see `current()` in load.js). The rename is deliberate -- `getPosts()` makes
 * the call visible at each use site, where `allPosts()` would let a reader
 * assume a cheap property access and cache it, reintroducing the staleness. The
 * returned array is the shared snapshot: read it, do not sort or mutate it
 * in place, and do not hold it across a render.
 */
import "server-only";

export {
  getPosts,
  getPages,
  getPost,
  getPage,
  getBodyHtml,
  getAllPostsWithBody,
} from "./load.js";
