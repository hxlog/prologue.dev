import { unified } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkGemoji from "remark-gemoji";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeShiki from "@shikijs/rehype";
import readingTime from "reading-time";

import rehypeFigure from "../../components/rehype-figure.js";
import rehypeMermaidPre from "../../components/rehype-mermaid-pre.js";

/**
 * Bump whenever this file, or any remark/rehype/shiki/katex dependency,
 * changes in a way that can alter rendered output. Rows whose stored
 * `renderer_version` is lower than this are stale and must be re-rendered.
 *
 * This is not optional bookkeeping: upgrading @shikijs/langs alone was
 * measured to change token colours in 2 of 63 existing posts with no config
 * change at all.
 */
export const RENDERER_VERSION = 1;

/**
 * Languages that actually appear in this blog's content (measured across all
 * 63 posts), plus a small forward-looking margin for new posts.
 *
 * This list is REQUIRED, not an optimisation. @shikijs/rehype defaults to all
 * 346 bundled grammars, which costs ~3.8 s to initialise on a cold lambda and
 * ~7-11 s including module import. Passing an explicit list drops highlighter
 * construction to ~1.3 ms. A fence in a language absent from this list is
 * rendered as unhighlighted code, not an error.
 */
const SHIKI_LANGS = [
  "r",
  "py",
  "python",
  "rust",
  "js",
  "javascript",
  "ts",
  "typescript",
  "yaml",
  "text",
  "mermaid",
  "html",
  "css",
  "json",
  "bash",
  "sh",
  "sql",
  "go",
  "diff",
];

const SHIKI_THEMES = {
  light: "material-theme-lighter",
  dark: "material-theme-darker",
};

/**
 * Build the unified processor.
 *
 * The plugin list deliberately mirrors what Contentlayer2 did implicitly:
 * `@contentlayer2/core` wrapped the user's plugin arrays in
 * remark-frontmatter / remark-parse / remark-rehype / rehype-stringify, and
 * the config additionally listed remarkParse, remarkRehype and
 * rehype-stringify itself. Because both sides resolved the *same* module
 * instances, unified's identity-based de-duplication made the duplicates
 * no-ops. They are kept here so that the effective order is provably the same
 * as the pipeline that produced the stored HTML.
 *
 * Order matters and is load-bearing:
 *   - rehypeMermaidPre rewrites ```mermaid fences to <pre class="mermaid">
 *     BEFORE rehypeShiki could highlight them as syntax.
 *   - rehypeStringify sits between them in the original config and is a no-op
 *     at that position (it only assigns the compiler); it is preserved.
 */
function createProcessor() {
  return unified()
    .use(remarkFrontmatter)
    .use(remarkParse)
    .use([remarkParse, remarkRehype, remarkGfm, remarkMath, remarkGemoji])
    .use(remarkRehype)
    .use([
      [
        rehypeKatex,
        {
          // trust:true let LaTeX emit real <a href>, <img>, and style/class/
          // data-* attributes straight into dangerouslySetInnerHTML with no
          // sanitizer anywhere in the repo. No post uses a trust-requiring
          // command (\href, \includegraphics, \htmlStyle, ...), so this is a
          // pure hardening with zero output change on existing content.
          strict: false,
          trust: false,
          output: "htmlAndMathml",
        },
      ],
      rehypeSlug,
      rehypeFigure,
      rehypeMermaidPre,
      rehypeStringify,
      [
        rehypeShiki,
        {
          themes: SHIKI_THEMES,
          // Emit only --shiki-light/--shiki-dark CSS variables per token; the
          // active colour is chosen by globals.css.
          defaultColor: false,
          langs: SHIKI_LANGS,
        },
      ],
    ])
    .use(rehypeStringify);
}

/**
 * The single renderer used by publishing, preview and the backfill script.
 *
 * Because preview and publish call this same function, the two can never
 * diverge — which is the entire reason the storage design works.
 *
 * @param {string} markdown - the raw markdown source, frontmatter INCLUDED.
 *   remark-frontmatter strips the `---` block, matching Contentlayer, which
 *   passed the whole file through (including frontmatter) as the body.
 * @returns {Promise<{html: string, headings: Array, readingTime: object|null}>}
 */
export async function renderMarkdown(markdown) {
  const source = String(markdown ?? "");
  const file = await createProcessor().process(source);
  const html = String(file);

  return {
    html,
    headings: extractHeadings(source),
    readingTime: readingTime(source, { wordsPerMinute: 1000 }),
  };
}

/**
 * Table-of-contents headings.
 *
 * This reproduces Contentlayer's `headings` computed field EXACTLY, bug for
 * bug, because the current TOC's behaviour depends on it. Known defects, kept
 * deliberately and tracked in db/README.md:
 *
 *   1. The regex requires a preceding newline, so a file whose FIRST line is a
 *      heading never yields that heading.
 *   2. The level mapping is impossible to satisfy: the pattern demands 2-6
 *      `#`, so `#` can never match, and every level from 4 to 6 maps to
 *      "three" (`flag.length == 1 ? one : flag.length == 2 ? two : three`).
 *   3. `id` is `text.split(" ").join("-").toLowerCase()`, which is NOT the
 *      anchor id remark-rehype + github-slugger actually emits. The TOC
 *      happens to work because it also tries `getElementById(heading.text)`.
 *
 * Fixing any of these changes the rendered TOC, so it is a deliberate,
 * separate change — not something to "clean up" during a migration.
 */
export function extractHeadings(markdown) {
  const regXHeader = /\n(?<flag>#{2,6})\s+(?<content>.+)/g;
  return Array.from(String(markdown ?? "").matchAll(regXHeader)).map(
    ({ groups }) => {
      const flag = groups?.flag;
      const content = groups?.content;
      return {
        level: flag?.length == 1 ? "one" : flag?.length == 2 ? "two" : "three",
        text: content,
        id: content.split(" ").join("-").toLowerCase(),
      };
    }
  );
}

/**
 * Derive the route-visible slug fields from a content file path.
 *
 * Mirrors Contentlayer's computedFields over `_raw.flattenedPath`:
 *   data/content/blog/First_Job_First_Exit.md -> flattenedPath
 *     "blog/First_Job_First_Exit"
 *   urlslug      "/blog/First_Job_First_Exit"   (case preserved)
 *   slug         "/blog/first_job_first_exit"   (lowercased)
 *   slugAsParams "first_job_first_exit"         (first segment dropped)
 *
 * `slugAsParams` is what the /blog/[...slug] route matches on, so it is
 * lowercased — that behaviour is load-bearing for every existing URL and must
 * not change.
 */
export function deriveSlugs(flattenedPath) {
  const urlslug = `/${flattenedPath}`;
  return {
    urlslug,
    slug: urlslug.toLowerCase(),
    slugAsParams: flattenedPath.split("/").slice(1).join("/").toLowerCase(),
  };
}
