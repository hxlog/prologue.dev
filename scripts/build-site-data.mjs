/**
 * Generates `data/sitemetadata.js` and `data/tagLabels.js` from the two
 * Obsidian-editable notes `data/site.md` and `data/tags.md`.
 *
 * WHY A GENERATOR EXISTS AT ALL. Site metadata and tag labels are read by
 * *client* components (navbar, footer, the modals, the tag chips), so their
 * values have to be in the JS module graph and shipped to the browser. A
 * browser cannot import markdown, and a `.md` read with `fs` at render time
 * cannot reach a Client Component either. So the markdown is the source and
 * the `.js` is the derived artifact -- the vault edits the note, this rebuilds
 * the module.
 *
 * The generated files are COMMITTED, not gitignored. That is the whole
 * safety story: `npm run build` on a fresh clone works without this script
 * having run, and every generator step shows up as a reviewable diff in
 * `data/sitemetadata.js` rather than as a silent change at build time. It
 * also means these two files are the one place in the repo where a generated
 * artifact is checked in -- deliberately, and for the reason above.
 *
 * Both notes are plain frontmatter / GFM, parsed with the same remark stack
 * the rest of the repo uses, so what Obsidian shows is what gets generated.
 *
 * Usage: node scripts/build-site-data.mjs [--check] [--template]
 *   --check     fail if the committed .js files are out of date instead of
 *               rewriting them (used by `npm run check`)
 *   --template  operate on `template/data/` -- the starter's own notes and
 *               generated modules, which ship to the public template repo
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString } from "mdast-util-to-string";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CHECK = process.argv.includes("--check");
// The starter's files are the same shape but a separate copy, and they must be
// regenerated from the starter's own notes -- a template clone runs `dev` on
// first command, and if its committed .js disagreed with its .md the clone
// would be dirty before the user had edited anything.
const TEMPLATE = process.argv.includes("--template");
const DATA = path.join(ROOT, TEMPLATE ? path.join("template", "data") : "data");
// Console messages name the real directory; the generated banner always says
// `data/...` on purpose. The published starter copies `template/data/` to its
// own `data/`, where `dev`/`build` re-run this script with no flag -- if the
// banner named `template/data/` there, every fresh clone's first build would
// rewrite the banner and leave the tree dirty.
const DATA_REL = TEMPLATE ? "template/data" : "data";

const SITE_MD = path.join(DATA, "site.md");
const TAGS_MD = path.join(DATA, "tags.md");
const SITE_JS = path.join(DATA, "sitemetadata.js");
const TAGS_JS = path.join(DATA, "tagLabels.js");

const parser = unified().use(remarkParse).use(remarkGfm);

function fail(file, message) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  throw new Error(`[site-data] ${rel}: ${message}`);
}

function frontmatter(file) {
  const data = matter(readFileSync(file, "utf8")).data;
  if (!data || Object.keys(data).length === 0) {
    fail(file, "has no frontmatter; the properties panel is the source");
  }
  return data;
}

function requiredString(file, data, key) {
  const value = data[key];
  if (typeof value !== "string" || value.trim() === "") {
    fail(file, `"${key}" is required and must be a non-empty string`);
  }
  return value;
}

function optionalString(file, data, key) {
  const value = data[key];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    fail(file, `"${key}" must be a string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function stringList(file, data, key) {
  const value = data[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    fail(file, `"${key}" must be a list, got ${JSON.stringify(value)}`);
  }
  return value.map((item) => {
    if (typeof item !== "string") {
      fail(file, `"${key}" must contain strings, got ${JSON.stringify(item)}`);
    }
    return item;
  });
}

/**
 * Serialize one scalar for a generated `.js` file.
 *
 * JSON.stringify is used for everything except plain ASCII identifiers, and
 * then the result is `JSON.parse`-checked on the way out by --check, so the
 * generated file is always valid JS no matter what a property value contains
 * (a stray quote in `description` must not break the build).
 */
function literal(value) {
  return JSON.stringify(value);
}

/**
 * data/site.md -> data/sitemetadata.js
 *
 * The four `umami*` keys are flattened in the note (frontmatter cannot hold a
 * nested object -- Obsidian shows one as an opaque JSON string and rewrites it
 * on any unrelated edit) and folded back into `siteMetadata.umami` here, so
 * every consumer keeps the exact shape it had when this was hand-written.
 * All four are required together: a half-filled analytics block is a
 * misconfiguration, not a feature.
 */
function siteMetadataSource() {
  const data = frontmatter(SITE_MD);

  const metadata = {
    title: requiredString(SITE_MD, data, "title"),
    author: requiredString(SITE_MD, data, "author"),
    authorDesc: optionalString(SITE_MD, data, "authorDesc"),
    publishName: requiredString(SITE_MD, data, "publishName"),
    headerTitle: optionalString(SITE_MD, data, "headerTitle"),
    description: optionalString(SITE_MD, data, "description"),
    language: requiredString(SITE_MD, data, "language"),
    keywords: stringList(SITE_MD, data, "keywords"),
    siteUrl: requiredString(SITE_MD, data, "siteUrl"),
    siteRepo: optionalString(SITE_MD, data, "siteRepo"),
    repoid: optionalString(SITE_MD, data, "repoid"),
    categoryid: optionalString(SITE_MD, data, "categoryid"),
    favicon: optionalString(SITE_MD, data, "favicon"),
    avatar: optionalString(SITE_MD, data, "avatar"),
    cover: optionalString(SITE_MD, data, "cover"),
    email: optionalString(SITE_MD, data, "email"),
    github: optionalString(SITE_MD, data, "github"),
  };

  const umami = {
    scriptUrl: optionalString(SITE_MD, data, "umamiScriptUrl"),
    recorderUrl: optionalString(SITE_MD, data, "umamiRecorderUrl"),
    websiteId: optionalString(SITE_MD, data, "umamiWebsiteId"),
    domains: optionalString(SITE_MD, data, "umamiDomains"),
  };
  const configured = Object.values(umami).filter(Boolean);
  if (configured.length > 0 && configured.length < 4) {
    fail(
      SITE_MD,
      "the analytics block is half-configured: set all of umamiScriptUrl, " +
        "umamiRecorderUrl, umamiWebsiteId and umamiDomains, or none of them"
    );
  }
  if (configured.length === 4) metadata.umami = umami;

  // `wechatofficialaccount` is the WeChat row in the RSS modal, not something
  // the RSS library knows about; it is emitted only when the vault sets it.
  const wechat = optionalString(SITE_MD, data, "wechatofficialaccount");
  if (wechat) metadata.wechatofficialaccount = wechat;

  const lines = Object.entries(metadata).map(([key, value]) => {
    if (key === "umami") {
      const inner = Object.entries(value)
        .map(([k, v]) => `    ${k}: ${literal(v)},`)
        .join("\n");
      return `  umami: {\n${inner}\n  },`;
    }
    return `  ${key}: ${literal(value)},`;
  });

  return `/**
 * GENERATED by scripts/build-site-data.mjs -- do not edit.
 *
 * Source: data/site.md (edit that note in Obsidian, then run
 * \`npm run site-data\`). This file is committed so a clone builds without the
 * generator having run; if the two disagree, \`npm run check\` fails and names
 * the field.
 */
const siteMetadata = {
${lines.join("\n")}
};

module.exports = siteMetadata;
`;
}

/**
 * data/tags.md -> data/tagLabels.js
 *
 * A GFM table, one row per tag. Serialized as a plain object literal rather
 * than JSON so the generated module keeps the exact byte shape the hand-written
 * one had (and keeps `export default` + the named `tagLabel` helper).
 */
function tagLabelsSource() {
  const tree = parser.parse(readFileSync(TAGS_MD, "utf8"));
  const table = tree.children.find((node) => node.type === "table");
  if (!table) fail(TAGS_MD, "no table found; the labels are a GFM table");

  const [head, ...rows] = table.children;
  const columns = head.children.map((cell) => toString(cell).trim());
  const slugAt = columns.indexOf("slug");
  const labelAt = columns.indexOf("label");
  if (slugAt === -1 || labelAt === -1) {
    fail(TAGS_MD, `the table needs "slug" and "label" columns, found: ${columns.join(", ")}`);
  }

  const seen = new Set();
  const entries = rows.map((row) => {
    const cells = row.children.map((cell) => toString(cell).trim());
    const slug = cells[slugAt];
    const label = cells[labelAt];
    if (!slug) fail(TAGS_MD, "a row has an empty slug");
    if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
      fail(
        TAGS_MD,
        `"${slug}" is not a usable slug: tag slugs go in /tags/<slug> URLs and ` +
          "in post frontmatter, so they must be ASCII letters, digits, _ or -"
      );
    }
    if (seen.has(slug)) fail(TAGS_MD, `duplicate slug ${slug}`);
    seen.add(slug);
    if (!label) fail(TAGS_MD, `the "${slug}" row has an empty label`);
    return [slug, label];
  });

  const body = entries.map(([slug, label]) => `  ${slug}: ${literal(label)},`).join("\n");

  return `/**
 * GENERATED by scripts/build-site-data.mjs -- do not edit.
 *
 * Source: data/tags.md (edit that note in Obsidian, then run
 * \`npm run site-data\`). Committed so a clone builds without the generator.
 *
 * Tag slugs stay English (stable URLs, feeds, analytics), the UI renders the
 * labels. Single source of truth for every tag consumer: cards, tag chips,
 * the tag sidebar, tag page headers, the Fuse search index and related posts.
 */
const tagLabels = {
${body}
};

/** Display label for a tag slug, falling back to the slug itself. */
export function tagLabel(tag) {
  return tagLabels[tag] || tag;
}

export default tagLabels;
`;
}

function emit(file, source) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  if (CHECK) {
    const current = readFileSync(file, "utf8");
    if (current !== source) {
      throw new Error(
        `[site-data] ${rel} is out of date with its note. ` +
          `Run \`npm run site-data${TEMPLATE ? " -- --template" : ""}\` and commit the result.`
      );
    }
    return;
  }
  writeFileSync(file, source);
}

// CRLF normalization: the generated files must be byte-identical on every
// machine, and git's autocrlf would otherwise make a Windows checkout
// disagree with a Linux one for no reason.
function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

emit(SITE_JS, normalize(siteMetadataSource()));
emit(TAGS_JS, normalize(tagLabelsSource()));

if (CHECK) {
  console.log(
    `site-data: ${DATA_REL}/site.md and ${DATA_REL}/tags.md are in sync with the generated modules`
  );
} else {
  console.log(`site-data: wrote ${DATA_REL}/sitemetadata.js and ${DATA_REL}/tagLabels.js`);
}
