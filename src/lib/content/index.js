/**
 * The site's content API -- the drop-in replacement for `contentlayer/generated`.
 *
 * The `server-only` guard is HERE and only here. It is what stops a Client
 * Component from pulling the filesystem in; the bundler resolves the
 * `react-server` condition for the RSC graph and rejects the import otherwise.
 * load.js / pipeline.js / slug.js deliberately do not carry it, so a plain
 * `node scripts/...` can import them (see scripts/check-render-equivalence.mjs).
 */
import "server-only";

export {
  allPosts,
  allPages,
  getPost,
  getPage,
  getBodyHtml,
  getAllPostsWithBody,
} from "./load.js";
