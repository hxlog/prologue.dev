/**
 * Vault data access for the two `data/*.md` datasets.
 *
 * Both are plain markdown notes the Obsidian vault can edit directly:
 *
 *   data/microblog.md  -- one `##` section per entry, date as the heading,
 *                         `<!-- id: mb-YYYYMMDD-N -->` as the stable anchor,
 *                         ordinary paragraphs and `![caption](src)` embeds.
 *   data/links.md      -- a GFM table, one row per friend.
 *
 * Parsing goes through the same remark stack the post pipeline uses
 * (remark-parse + remark-gfm), so what Obsidian shows and what the site reads
 * cannot drift.
 *
 * WHY NOT gray-matter FOR THE BODIES: `matter()` would give us the frontmatter,
 * but the body has to be parsed as mdast anyway, and mdast already records the
 * byte offsets of every block -- which is how a section's raw markdown is
 * recovered verbatim (see `sliceSection`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString } from "mdast-util-to-string";

const MD_FILE = path.join(process.cwd(), "data", "microblog.md");
const LINKS_FILE = path.join(process.cwd(), "data", "links.md");

// No remark-math / gemoji / katex here: these datasets carry prose and images
// only, and pulling in the post pipeline would drag Shiki into every render for
// no benefit. GFM is required -- the links file IS a table.
const parser = unified().use(remarkParse).use(remarkGfm);

const ID_RE = /^\s*<!--\s*id:\s*([A-Za-z0-9_-]+)\s*-->\s*$/;

function blocks(file) {
  const raw = readFileSync(file, "utf8");
  const { content } = matter(raw);
  return { raw: content, tree: parser.parse(content) };
}

/**
 * The microblog entries, newest first.
 *
 * Returns the same shape the YAML loader did -- { id, date, paragraphs[],
 * images[{src, desc}] } -- so every consumer keeps working unchanged.
 */
export function getMicroblog() {
  const { raw, tree } = blocks(MD_FILE);
  return sections(raw, tree).sort((a, b) => new Date(b.date) - new Date(a.date));
}

/** The friend links, in file order. */
export function getLinks() {
  const { tree } = blocks(LINKS_FILE);
  const table = tree.children.find((n) => n.type === "table");
  if (!table) return [];

  const [head, ...rows] = table.children;
  const columns = head.children.map((cell) => toString(cell).trim());

  return rows.map((row) => {
    const record = {};
    row.children.forEach((cell, i) => {
      const key = columns[i];
      if (key) record[key] = toString(cell);
    });
    return record;
  });
}

/**
 * Split the mdast into one record per `## <date>` heading.
 *
 * The heading is the date and the anchor comes from the `<!-- id: ... -->`
 * comment that must follow it. The id is REQUIRED and never derived: deriving
 * it from position (as the old YAML loader did with its array index) means
 * reordering the file silently renumbers every later entry, breaking
 * /microblog#<id> anchors and RSS guids at once.
 */
function sections(raw, tree) {
  const entries = [];
  const children = tree.children;

  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type !== "heading" || node.depth !== 2) continue;

    const date = toString(node).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      fail(`"${date}" is not a section date; headings must be YYYY-MM-DD`);
    }

    const marker = children[i + 1];
    const id = marker?.type === "html" ? ID_RE.exec(marker.value)?.[1] : undefined;
    if (!id) {
      fail(`the "${date}" section has no "<!-- id: ... -->" line under it`);
    }

    // Everything from just past the id comment to the next `##` heading.
    const start = children[i + 1].position.end.offset;
    const next = children.findIndex(
      (n, j) => j > i + 1 && n.type === "heading" && n.depth === 2
    );
    const end =
      next === -1 ? raw.length : children[next].position.start.offset;
    const body = raw.slice(start, end);

    const entry = normalize({ id, date, body });
    if (entries.some((e) => e.id === entry.id)) {
      fail(`duplicate id ${entry.id}; ids must be unique`);
    }
    entries.push(entry);
  }

  return entries;
}

/** `date` + raw markdown body -> { id, date, paragraphs[], images[] }. */
function normalize({ id, date, body }) {
  const tree = parser.parse(body.trim());
  const paragraphs = [];
  const images = [];

  for (const node of tree.children) {
    if (node.type === "paragraph") {
      const only = node.children.length === 1 ? node.children[0] : null;
      if (only?.type === "image") {
        images.push({ src: only.url, desc: toString(only) });
        continue;
      }
      paragraphs.push(toString(node).replace(/\n/g, " ").trim());
      // A paragraph mixing text and images: keep the text, and the images after.
      for (const child of node.children) {
        if (child.type === "image") {
          images.push({ src: child.url, desc: toString(child) });
        }
      }
    } else if (node.type === "image") {
      images.push({ src: node.url, desc: toString(node) });
    }
  }

  return {
    id,
    date,
    paragraphs: paragraphs.filter(Boolean),
    images: images.filter((img) => img.src),
  };
}

/** HTML serialization for the microblog RSS feed (paragraphs + figures). */
export function entryToHtml(entry, absolutize) {
  const parts = [];
  for (const p of entry.paragraphs) {
    parts.push(`<p>${escapeHtml(p)}</p>`);
  }
  for (const img of entry.images) {
    const src = absolutize(img.src);
    const alt = escapeHtml(img.desc || "");
    parts.push(
      `<figure><img src="${src}" alt="${alt}" loading="lazy" />${
        img.desc ? `<figcaption>${escapeHtml(img.desc)}</figcaption>` : ""
      }</figure>`
    );
  }
  return parts.join("");
}

function fail(message) {
  throw new Error(`[vault] ${path.basename(MD_FILE)}: ${message}`);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
