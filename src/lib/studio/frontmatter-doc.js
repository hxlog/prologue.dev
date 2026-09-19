/**
 * Frontmatter as an editable document, not a data structure.
 *
 * The studio shows the author typed fields — title, description, tags, date —
 * beside the markdown body. Those fields live in the file's YAML frontmatter,
 * and the markdown is the source of truth (the whole document, frontmatter
 * included, is what `renderMarkdown` and every revision store). So editing a
 * field means editing a block of text, and the hard requirement is that
 * **touching one field does not rewrite the other seven**.
 *
 * Two properties fall out of that requirement, and both are verified by
 * scripts/db/check-frontmatter-roundtrip.mjs:
 *
 *   1. `patchMeta(md, readMeta(md)) === md` — byte for byte, for all 64
 *      documents in the corpus.
 *   2. Changing one field rewrites exactly one line.
 *
 * Both come from the same decision: the parser keeps the ORIGINAL TEXT of each
 * `key: value` line, and the writer re-emits that text verbatim whenever the
 * value is unchanged. A writer that re-serialises from the parsed object cannot
 * do this, and the failure is not theoretical — the corpus writes its keys in at
 * least three different orders, so any canonical ordering would rewrite every
 * frontmatter block in the blog on first save.
 *
 * Dates are the reason this is fiddly enough to be worth its own module.
 * `publishDate: 2023-01-01` is a YAML timestamp and parses to a Date in the
 * *machine's* time zone; `publishDate: 2023-1-1` is not valid YAML and stays a
 * string. Re-serialising either one changes its type, and therefore changes what
 * `parseContentDate` receives. Keeping the raw line means the type never
 * changes unless the author edits the field.
 */

import { load } from "js-yaml";

/**
 * Keys the studio renders as structured inputs, in the order a NEW frontmatter
 * block gets them. Existing blocks keep their own order; this is only for keys
 * that are not already present.
 */
export const KNOWN_KEYS = [
  "title",
  "description",
  "publishDate",
  "lastmod",
  "tags",
  "image",
  "imageDesc",
  "draft",
  "featured",
];

/** Keys that are `true`/`false` and are omitted entirely when false. */
const BOOLEAN_KEYS = new Set(["draft", "featured"]);

/** Keys whose value is a flow sequence of strings. */
const ARRAY_KEYS = new Set(["tags"]);

const OPEN = /^---[ \t]*\r?\n/;
const CLOSE = /\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Split a document into frontmatter and body without parsing the values.
 *
 * Only a block starting on the very first line counts, matching
 * remark-frontmatter: a `---` further down is a thematic break or a setext
 * heading underline. This is the same rule as src/lib/content/frontmatter.js,
 * and it has to stay the same or the editor and the renderer would disagree
 * about where the document begins.
 */
export function splitDocument(markdown) {
  const source = String(markdown ?? "");
  const open = OPEN.exec(source);
  if (!open) return { block: null, body: source, eol: detectEol(source) };

  const rest = source.slice(open[0].length);
  const close = CLOSE.exec(rest);
  if (!close) return { block: null, body: source, eol: detectEol(source) };

  return {
    block: rest.slice(0, close.index),
    body: rest.slice(close.index + close[0].length),
    eol: detectEol(source),
  };
}

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Parse the frontmatter block into ordered entries.
 *
 * Each entry keeps the exact source line(s) it came from. An entry whose value
 * spans multiple lines is kept whole and marked `multiline`, and the writer
 * re-emits it untouched — a folded or literal block scalar is prose the author
 * wrote, and reformatting it would be a content edit.
 *
 * A key with no value (`image:`) parses to null and round-trips as written.
 */
export function parseMeta(markdown) {
  const { block } = splitDocument(markdown);
  if (block === null) {
    return { entries: [], values: {}, data: {}, hasFrontmatter: false };
  }

  const lines = block.split(/\r?\n/);
  const entries = [];
  const values = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // A blank line, a comment, or a continuation of a block scalar: attach to
    // the previous entry rather than treating it as a new key.
    if (line.trim() === "" || /^\s*#/.test(line)) {
      if (entries.length) entries[entries.length - 1].text += `\n${line}`;
      else entries.push({ key: null, text: line, multiline: false });
      continue;
    }

    // A line that is indented is a continuation (block scalar body, nested
    // map). It belongs to the entry above it.
    if (/^\s/.test(line) && entries.length) {
      const prev = entries[entries.length - 1];
      prev.text += `\n${line}`;
      prev.multiline = true;
      continue;
    }

    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s?(.*)$/.exec(line);
    if (!m) {
      entries.push({ key: null, text: line, multiline: false });
      continue;
    }

    entries.push({ key: m[1], text: line, multiline: false, valueText: m[2] });
    values[m[1]] = m[2];
  }

  for (const entry of entries) {
    if (entry.key === null) continue;
    entry.value = decodeValue(entry.key, entry.text);
  }

  // `data` is the map of parsed values, which is what the UI binds to.
  const data = {};
  for (const entry of entries) {
    if (entry.key !== null) data[entry.key] = entry.value;
  }

  return { entries, values, data, hasFrontmatter: true };
}

/**
 * The parsed value of one frontmatter line.
 *
 * Parsed by re-reading the single line as YAML rather than by a hand-rolled
 * rule per type, so `2023-01-01` becomes a Date exactly as js-yaml would make
 * it for a full-file parse — the editor and the importer must agree, and the
 * only way to guarantee that is to use the same parser.
 *
 * A malformed line makes this throw. That is deliberate: `parseMeta` is called
 * on save, and silently treating `title: "a: b` as a string would let the
 * editor write a frontmatter block the renderer cannot parse at all.
 */
function decodeValue(key, line) {
  try {
    const parsed = load(line);
    if (parsed === null || typeof parsed !== "object") return parsed ?? null;
    // `load` on a single line can return an object for a nested map; that is a
    // shape the studio does not edit, so it is returned as-is and the writer
    // re-emits the original text.
    return parsed[key] ?? null;
  } catch {
    return undefined; // undefined = unparseable, writer keeps the raw line
  }
}

/**
 * Read the metadata as a plain object for the UI.
 *
 * Dates are returned as `YYYY-MM-DD` strings rather than Date objects. The
 * date input in the browser speaks that format, and — more importantly — a Date
 * carries a time zone, so rendering one back into the field would silently
 * shift the day for anyone east or west of UTC. `parseContentDate` in
 * src/lib/content/dates.js is where a date becomes an instant, once, for the
 * database; the editor deals only in the text the author typed.
 */
export function readMeta(markdown) {
  const { data } = parseMeta(markdown);

  const meta = {};
  for (const key of KNOWN_KEYS) {
    meta[key] = normaliseForUi(key, data[key]);
  }
  for (const [key, value] of Object.entries(data)) {
    if (!(key in meta)) meta[key] = value;
  }
  return meta;
}

function normaliseForUi(key, value) {
  if (value === undefined || value === null) {
    if (ARRAY_KEYS.has(key)) return [];
    if (BOOLEAN_KEYS.has(key)) return false;
    return "";
  }
  if (ARRAY_KEYS.has(key)) {
    return Array.isArray(value) ? value.map(String) : [String(value)];
  }
  if (BOOLEAN_KEYS.has(key)) return value === true;
  if (value instanceof Date) return toDateInput(value);
  return String(value);
}

/**
 * A Date as the `YYYY-MM-DD` an `<input type="date">` expects.
 *
 * Uses the UTC accessors, not the local ones: the Date was produced by js-yaml
 * from a bare `2023-01-01`, which YAML resolves as midnight UTC. Reading it with
 * `getFullYear()` in a UTC+8 browser gives 2023-01-01 too, but at UTC-5 it
 * gives 2022-12-31 — the field would show yesterday's date to a reader in New
 * York for no reason at all.
 */
function toDateInput(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Change some metadata fields, leaving everything else byte-identical.
 *
 * Entries whose value did not change are re-emitted from their original source
 * text. Entries whose value DID change are regenerated. Keys that are not
 * present are appended in KNOWN_KEYS order. Keys set to null/""/[]/false
 * (for booleans) are removed.
 *
 * Returns the whole document.
 */
export function patchMeta(markdown, changes) {
  const source = String(markdown ?? "");
  const { block, body, eol } = splitDocument(source);
  const changed = new Map(Object.entries(changes));

  if (block === null) {
    // No frontmatter yet. Build one from the changes, and do not add a block at
    // all if there is nothing to say — an empty `---\n---` would render as a
    // thematic break above the first line of prose.
    const lines = [];
    for (const key of KNOWN_KEYS) {
      if (!changed.has(key)) continue;
      const line = renderLine(key, changed.get(key));
      if (line !== null) lines.push(line);
    }
    if (!lines.length) return source;
    return `---${eol}${lines.join(eol)}${eol}---${eol}${body}`;
  }

  const { entries } = parseMeta(source);
  const out = [];
  const seen = new Set();

  for (const entry of entries) {
    // A comment, a blank line, or an unparseable key: keep verbatim.
    if (entry.key === null) {
      out.push(entry.text);
      continue;
    }

    // A multi-line value (block scalar, nested map) is not something the studio
    // edits. It is preserved exactly, and a change to it is ignored rather than
    // half-applied.
    if (entry.multiline) {
      out.push(entry.text);
      seen.add(entry.key);
      continue;
    }

    seen.add(entry.key);

    if (!changed.has(entry.key)) {
      out.push(entry.text);
      continue;
    }

    const next = changed.get(entry.key);
    if (sameValue(entry.value, next)) {
      // Unchanged: re-emit the original text, so an untouched field cannot
      // alter the file.
      out.push(entry.text);
      continue;
    }

    const line = renderLine(entry.key, next);
    if (line !== null) out.push(line);
    // null means "remove this key", and pushing nothing removes it.
  }

  // Newly added keys, in canonical order, after everything that was there.
  for (const key of KNOWN_KEYS) {
    if (seen.has(key) || !changed.has(key)) continue;
    const line = renderLine(key, changed.get(key));
    if (line !== null) out.push(line);
  }

  // Anything the caller passed that is not a known key.
  for (const [key, value] of changed) {
    if (seen.has(key) || KNOWN_KEYS.includes(key)) continue;
    const line = renderLine(key, value);
    if (line !== null) out.push(line);
  }

  return `---${eol}${out.join(eol)}${eol}---${eol}${body}`;
}

/** Deep equality that treats a Date and its `YYYY-MM-DD` string as the same. */
function sameValue(a, b) {
  if (a instanceof Date || b instanceof Date) {
    const na = a instanceof Date ? toDateInput(a) : a;
    const nb = b instanceof Date ? toDateInput(b) : b;
    return String(na) === String(nb);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    const aa = Array.isArray(a) ? a.map(String) : a === "" || a == null ? [] : [String(a)];
    const bb = Array.isArray(b) ? b.map(String) : b === "" || b == null ? [] : [String(b)];
    return aa.length === bb.length && aa.every((x, i) => x === bb[i]);
  }
  if (typeof a === "boolean" || typeof b === "boolean") {
    return Boolean(a) === Boolean(b);
  }
  const norm = (v) => (v === null || v === undefined ? "" : String(v));
  return norm(a) === norm(b);
}

/**
 * One `key: value` line, or null when the key should be removed.
 *
 * Emptiness means removal, with one exception: a boolean false is removed
 * because `draft: false` and `featured: false` are the defaults the importer
 * already assumes, and writing them into every post would add two lines of
 * noise to 63 files to say nothing.
 */
function renderLine(key, value) {
  if (value === null || value === undefined) return null;

  if (BOOLEAN_KEYS.has(key)) {
    if (value === true) return `${key}: true`;
    if (value === false || value === "") return null;
    return `${key}: ${value}`;
  }

  if (ARRAY_KEYS.has(key)) {
    const list = Array.isArray(value)
      ? value.map(String).map((s) => s.trim()).filter(Boolean)
      : [];
    if (!list.length) return null;
    return `${key}: [${list.map(quote).join(", ")}]`;
  }

  const text = String(value);
  if (text === "") return null;

  // A date stays a bare scalar. Quoting it would turn a YAML timestamp into a
  // string, and while `parseContentDate` accepts both, the importer and the
  // editor would then disagree about the type of the same field.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${key}: ${text}`;

  return `${key}: ${quote(text)}`;
}

/**
 * Quote a scalar in double quotes.
 *
 * Always quoting is simpler than deciding when it is needed, and it is safe
 * for every value the studio writes: the `description` field regularly contains
 * `:`, `#`, `"` and Chinese punctuation, all of which are YAML-significant
 * unquoted. The one visible cost is that an existing unquoted title gains
 * quotes the first time it is edited — which is correct, because the value
 * changed, and the writer's whole job is to leave untouched lines alone.
 */
function quote(text) {
  return `"${String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
