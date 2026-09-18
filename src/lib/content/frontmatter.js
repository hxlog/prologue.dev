/**
 * Frontmatter parsing for content files.
 *
 * The site no longer builds content with Contentlayer, but the files on disk
 * still carry YAML frontmatter, and two things read it: the one-off import
 * scripts under scripts/db, and the editor in /studio, which shows the
 * frontmatter fields beside the markdown body and has to put them back.
 *
 * Deliberately dependency-light on the *values*: everything is returned as the
 * author typed it. Dates in particular are NOT converted to Date objects here.
 * The YAML timestamp type is a trap for exactly this corpus — `2025-2-15` is
 * not a valid YAML timestamp (month must be zero-padded), so it stays a string,
 * while `2025-02-15` is a valid one and would become a Date parsed in the
 * reader's time zone. Two dates that look the same in the file would then
 * arrive as two different kinds of value, and the shift is invisible until
 * someone compares a local render to production. Normalisation belongs in
 * src/lib/content/dates.js, which does it explicitly and identically
 * everywhere.
 */

import { load } from "js-yaml";

/**
 * Split a markdown document into its frontmatter and its body.
 *
 * Only a block that starts on the very first line counts, matching
 * remark-frontmatter: a `---` further down is a thematic break or a setext
 * heading underline. Both `---` delimiters have to be on their own line, so a
 * post whose prose contains a horizontal rule is not mistaken for one.
 *
 * @returns {{ data: object, body: string, raw: string|null }}
 *   `raw` is the frontmatter text without the delimiters, or null when there is
 *   no block. It is what a diff should show — the parsed object loses key order
 *   and comments, and a revision history that hides a reordered key list is
 *   hiding something the author did.
 */
export function parseFrontmatter(markdown) {
  const source = String(markdown ?? "");
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);

  if (!match) {
    return { data: {}, body: source, raw: null };
  }

  const raw = match[1];
  let data;

  try {
    const parsed = load(raw);
    // A frontmatter block holding only comments parses to undefined; a block
    // holding a list or a scalar is not a frontmatter block at all, but it is
    // not worth failing the import over — treat it as empty.
    data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    const error = new Error(`Invalid YAML frontmatter: ${err.message}`);
    error.cause = err;
    throw error;
  }

  return { data, body: source.slice(match[0].length), raw };
}
