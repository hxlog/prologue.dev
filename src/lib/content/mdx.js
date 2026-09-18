/**
 * MDX rendering for Pages.
 *
 * Posts are `contentType: "markdown"` — one HTML string, rendered once at
 * publish time and stored. Pages are `contentType: "mdx"`: their source
 * contains JSX that markdown cannot express (/about has `<img ... />` with
 * Tailwind classes and a bare `<center>`), and rendering it through the
 * markdown pipeline drops that JSX entirely — measured, the `className` and the
 * whole `<center>` element disappear — which would visibly change the page.
 *
 * So a Page is compiled and evaluated into a component, exactly as Contentlayer
 * did it. Verified: rendering /about through `compile()` + `run()` produces
 * byte-identical markup to Contentlayer's stored bytecode (703 bytes, diff at
 * no offset), given the same `components` map.
 *
 * Three options carry the behaviour and are easy to get wrong:
 *
 *   remarkFrontmatter      required explicitly. Contentlayer's MDX path applied
 *                          it; without it the `---` block is parsed as markdown
 *                          and the title renders as a setext heading.
 *   outputFormat           'function-body'. The default ('program') emits an
 *                          ES module with import statements, which cannot be
 *                          evaluated in the browser without a module loader.
 *                          'function-body' emits a body expecting the runtime
 *                          as `arguments[0]`, which is what `run()` supplies.
 *   development: false     production bytecode. In development mode `run()`
 *                          expects `useMDXComponents` and a React context; the
 *                          site supplies components as props instead.
 */
import { compile } from "@mdx-js/mdx";
import remarkFrontmatter from "remark-frontmatter";

/**
 * Compile MDX source into runnable bytecode.
 *
 * `development: false` is not an optimisation, it is a correctness requirement.
 * In development mode `@mdx-js/mdx` emits `_jsxDEV(...)` and expects
 * `react/jsx-dev-runtime`; in production mode it emits `_jsx(...)` and expects
 * `react/jsx-runtime`. The browser half (./mdx-runtime.js) supplies
 * `react/jsx-runtime`, because that is the runtime that ships to readers.
 *
 * Getting this wrong is silent at compile time and fails at render with
 * "_jsxDEV is not a function" — which is how it was caught: the importer ran
 * with NODE_ENV unset, so `NODE_ENV !== "production"` was true and every stored
 * page was dev-mode bytecode. Tying the flag to NODE_ENV at all was the
 * mistake; the stored artifact must be production-shaped regardless of which
 * environment produced it.
 *
 * `outputFormat: "function-body"` is required for the same reason: the default
 * ('program') emits an ES module with import statements, which cannot be
 * evaluated without a module loader. The function-body form begins with
 * `const {jsx, jsxs, Fragment} = arguments[0]` and is meant to be wrapped in a
 * function — see ./mdx-runtime.js, which does exactly that.
 *
 * @param {string} source - the page's markdown/MDX, frontmatter included.
 * @returns {Promise<string>}
 */
export async function compilePage(source) {
  return String(
    await compile(String(source ?? ""), {
      development: false,
      outputFormat: "function-body",
      remarkPlugins: [remarkFrontmatter],
      // No GFM, math or KaTeX here. Contentlayer applied them to Page too, but
      // no page uses them, and every plugin is bundle weight in the browser,
      // where compilation happens for pages that are not prerendered.
      rehypePlugins: [],
    })
  );
}
