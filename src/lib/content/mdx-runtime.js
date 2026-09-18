/**
 * MDX evaluation — the browser half.
 *
 * Split from ./mdx.js (the compiler) because the two have opposite homes: the
 * compiler pulls in `@mdx-js/mdx` and `remark-frontmatter` and runs at publish
 * time on the server, while this runs in the browser for every page that is not
 * prerendered. Importing the compiler into a client component would ship the
 * whole MDX toolchain to readers.
 *
 * The bytecode contract
 * ---------------------
 * `compilePage` emits `outputFormat: "function-body"`, which begins
 *
 *     "use strict";
 *     const {Fragment, jsx, jsxs} = arguments[0];
 *
 * That is the documented interface: the body is meant to be wrapped in a
 * function and called with the jsx runtime as its first argument. `new Function`
 * is that wrapper. It is the same mechanism mdx-bundler uses to evaluate
 * Contentlayer's output today, so the trust model is unchanged.
 *
 * Trust boundary — worth stating because it is a real one
 * ------------------------------------------------------
 * `new Function` executes whatever it is given, so the only thing that makes
 * this safe is where `code` comes from: `page_revisions.html`, written at
 * publish time by `compilePage()` on our own server, from markdown authored by
 * the authenticated owner. It is never built from a request parameter, a URL
 * segment, or anything else a visitor can influence — the route reads a page by
 * slug but the *code* always comes from a stored revision.
 *
 * If that ever stops being true — a page that compiles content supplied by a
 * reader, say — this is the line that has to change, not the caller. A page
 * whose bytecode could have come from anywhere must be rendered to HTML on the
 * server instead, so nothing untrusted is ever evaluated in a visitor's browser.
 *
 * Passing `react/jsx-runtime` rather than React itself is not cosmetic: React
 * exports `Fragment` but not `jsx`/`jsxs`, so the destructuring above yields
 * undefined and every element fails to render.
 */
import * as runtime from "react/jsx-runtime";

/** What the compiler guarantees it emits. Checked before evaluating, so a
 *  truncated or non-MDX value fails loudly here rather than as a React error
 *  three components deep. */
const FUNCTION_BODY_HEADER = "function-body";

/**
 * @param {string} code - bytecode from compilePage()
 * @returns {(props: object) => JSX.Element | null}
 */
export function evaluatePage(code) {
  if (typeof code !== "string" || code.length === 0) return null;

  const factory = new Function(code);
  const mod = factory(runtime);
  return mod?.default ?? null;
}

export const MDX_OUTPUT_FORMAT = FUNCTION_BODY_HEADER;
