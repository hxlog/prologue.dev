/**
 * The one markdown renderer. Server-only by virtue of its only caller,
 * ./index.js, which carries the `server-only` guard.
 *
 * Plugin order and options are copied from contentlayer.config.js.
 *
 * DO NOT add options to remarkRehype or rehypeStringify. Contentlayer called
 * both bare, which means raw HTML blocks collapse to their text content
 * ("<sup>x</sup>" -> "<p>x</p>"). Three posts depend on that.
 *
 * On plugin ORDER: with @shikijs/rehype 4.4.3 and rehype-stringify 10.0.1,
 * `rehypeShiki` before `rehypeStringify` and the reverse were both measured
 * byte-identical on this corpus. The order below is the one to keep; a future
 * version bump is the moment to re-measure, not to assume.
 *
 * NO `import "server-only"` HERE. The guard lives in ./index.js, the module the
 * site imports. Putting it here would make this file unimportable from a plain
 * `node scripts/...` run, which is how every check in this repo works.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkGemoji from "remark-gemoji";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkDirective from "remark-directive";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";

import rehypeFigure from "../../components/rehype-figure.js";
import rehypeMermaidPre from "../../components/rehype-mermaid-pre.js";

const CONTENT_DIR = path.join(process.cwd(), "data", "content");
const BLOG_DIR = path.join(CONTENT_DIR, "blog");
const YOUTUBE_ID = /^[\w-]{11}$/;
const YOUTUBE_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";

function remarkYoutube() {
  return (tree, file) => {
    visit(tree, (node, index, parent) => {
      if (!["containerDirective", "leafDirective", "textDirective"].includes(node.type)) {
        return;
      }

      if (node.name !== "youtube") {
        if (node.type === "textDirective" && parent && node.position) {
          parent.children[index] = {
            type: "text",
            value: file.value.slice(node.position.start.offset, node.position.end.offset),
          };
        }
        return;
      }

      if (node.type !== "leafDirective") {
        file.fail("Use a leaf directive: ::youtube[title]{#video-id}", node);
      }

      const videoId = node.attributes?.id;
      if (typeof videoId !== "string" || !YOUTUBE_ID.test(videoId)) {
        file.fail("Expected an 11-character YouTube video ID in the directive", node);
      }

      const title = toString(node).trim();
      if (!title) {
        file.fail("Add an accessible title to the YouTube directive", node);
      }

      const data = node.data || (node.data = {});
      data.hName = "div";
      data.hProperties = { className: ["video-embed"] };
      data.hChildren = [
        {
          type: "element",
          tagName: "iframe",
          properties: {
            src: `https://www.youtube.com/embed/${videoId}`,
            title,
            loading: "lazy",
            allow: YOUTUBE_ALLOW,
            referrerPolicy: "strict-origin-when-cross-origin",
            allowFullScreen: true,
          },
          children: [],
        },
      ];
    });
  };
}

/**
 * Shiki is essentially the entire cost of this pipeline (~13s cold for the
 * R/Python/Rust grammars and both themes, ~1.2s warm). @shikijs/rehype creates
 * and caches a highlighter per processor, so the PROCESSOR is the memo: one per
 * process, not one per document.
 */
let processorPromise = null;

async function getProcessor() {
  if (!processorPromise) {
    processorPromise = (async () => {
      const rehypeShiki = (await import("@shikijs/rehype")).default;
      return unified()
        .use(remarkParse)
        .use(remarkDirective)
        .use(remarkYoutube)
        .use(remarkRehype) // NO options -- see the warning above
        .use(remarkGfm)
        .use(remarkMath)
        .use(remarkGemoji)
        .use(rehypeKatex, { strict: false, trust: true, output: "htmlAndMathml" })
        .use(rehypeSlug) // no options: it has no slugger hook, and needs none
        .use(rehypeFigure)
        .use(rehypeMermaidPre)
        .use(rehypeShiki, {
          themes: {
            light: "material-theme-lighter",
            dark: "material-theme-darker",
          },
          defaultColor: false,
        })
        .use(rehypeStringify); // NO options
    })();
  }
  return processorPromise;
}

/** Render one markdown string to HTML. */
export async function renderMarkdown(raw) {
  const processor = await getProcessor();
  return String(await processor.process(raw.replace(/\r\n?/g, "\n")));
}

/** Strip a leading `---` frontmatter block. */
export function stripFrontmatter(raw) {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".md") || entry.endsWith(".mdx")) out.push(full);
  }
  return out;
}

/**
 * Render every blog post. Used by the equivalence harness; the site itself goes
 * through load.js, which memoizes per document. Verified to produce exactly the
 * 63 slugs the Contentlayer2 baseline contains.
 */
export async function renderAll() {
  const out = {};
  for (const file of walk(BLOG_DIR)) {
    const raw = readFileSync(file, "utf8");
    const flattened = path
      .relative(CONTENT_DIR, file)
      .replace(/\.(md|mdx)$/, "")
      .split(path.sep)
      .join("/");
    out[`/${flattened}`.toLowerCase()] = await renderMarkdown(stripFrontmatter(raw));
  }
  return out;
}
