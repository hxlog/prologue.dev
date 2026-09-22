/**
 * Node-script entry point for scripts/build-search-index.mjs. Identical to
 * ./index.js minus the `server-only` guard, which is why it can be imported
 * from a plain `node scripts/...` run.
 *
 * The site must import ./index.js instead.
 */
export {
  getPosts,
  getPages,
  getPost,
  getPage,
  getBodyHtml,
  getAllPostsWithBody,
} from "./load.js";
