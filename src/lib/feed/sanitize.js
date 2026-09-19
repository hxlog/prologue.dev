/**
 * The feed sanitizer: parse once, walk, enforce, serialize.
 *
 * ## Why this exists at all
 *
 * The item body a feed carries is HTML that a THIRD PARTY renders. Until now it
 * was assembled entirely by string surgery — a stack of regex passes — which is
 * fine for adding structure and useless as a defence: a regex cannot decide
 * whether an attribute is dangerous, and there is no list of "bad" strings that
 * is closed. What was there worked because the only author is trusted, which is
 * exactly the kind of reasoning that stops being true the moment a collection
 * entry, a pasted snippet or a future contributor reaches the same code path.
 *
 * ## What it is allowed to keep, and where that list came from
 *
 * Every tag, property and CSS declaration below was MEASURED against the 63
 * published posts — `scripts/studio/feed-survey.mjs` prints the tag inventory,
 * `feed-props.mjs` prints the property keys the parser actually produces and
 * `feed-styles.mjs` prints the CSS. An allowlist written from a guess is either
 * too narrow, silently deleting MathML from the seventeen posts that use it, or
 * too wide and therefore decorative.
 *
 * `feed-props.mjs` is the load-bearing one, because `hast-util-from-html` does
 * NOT hand back the attribute names that were in the document. It maps them
 * through property-information, so `class` arrives as `className`, `colspan` as
 * `colSpan`, `aria-hidden` as `ariaHidden`, `data-footnotes` as `dataFootnotes`
 * and `viewBox` stays `viewBox`. A list written in HTML spelling matches nothing
 * and the sanitizer silently strips every class in the corpus — which is how the
 * first version of this file deleted the syntax highlighting off all 58
 * highlighted code blocks while reporting success.
 *
 * ## Why an `<a href>` scheme is checked rather than trusted
 *
 * `absolutizeUrls` rewrites relative targets, and `absolutize` passes `mailto:`,
 * `tel:` and `data:` straight through. `data:` is the one that matters: an
 * `<a href="data:text/html,<script>…">` is a link a reader can click into a
 * document that runs from our origin in some readers. Every scheme is checked
 * here, independently of what the earlier pass produced.
 *
 * ## Where it runs, and why last
 *
 * After every other pass. Those passes ADD structure — `markDisplayMath` wraps a
 * formula in a centred paragraph, `transformMermaidDiagrams` swaps a `<pre>` for
 * a hosted `<img>`, `stripKatexPresentation` deletes a subtree — and a sanitizer
 * that ran first would have to allow the intermediate shapes too. Running last
 * means it sees exactly what a reader would, and the enforcement is against the
 * final artifact rather than against an approximation of it.
 *
 * It replaces the two passes that were doing the same job less completely:
 * `normalizeImages` (a hand-written `<img>` allowlist) and `fixVoidTags`
 * (covered by `closeSelfClosing`).
 */

import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";

/**
 * Elements a reader may receive. Tag names are lowercased, because parse5 runs
 * in HTML mode and reports SVG's camelCase names in lowercase.
 */
const ALLOWED_ELEMENTS = new Set([
  // Structure and text
  "p", "div", "span", "section", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "em", "del", "sup", "sub", "code", "pre",
  "blockquote", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "th", "td",
  "a", "img", "figure", "figcaption",

  // Forms are not allowed, but a GFM task list renders a DISABLED checkbox and
  // three posts use them. `input` is kept and then constrained below to
  // `type="checkbox"` with `disabled`, which cannot submit anything.
  "input",

  // MathML. 175 formulas across 17 posts, and the whole reason this list has to
  // be measured rather than guessed.
  "math", "semantics", "annotation", "mrow", "mi", "mo", "mn", "mtext",
  "mfrac", "msub", "msup", "msubsup", "munder", "mover", "munderover",
  "msqrt", "mspace", "mpadded", "mphantom", "mstyle", "mtable", "mtr", "mtd",
  "menclose", "mroot", "mmultiscripts", "mprescripts", "none",

  // SVG. The only instances in the corpus are KaTeX's stretchy delimiters, which
  // are part of a formula rather than a picture. Scripting inside an SVG is
  // impossible without `script`, `foreignObject` or an event attribute — and
  // `on*` is refused unconditionally below, while the other two are not on this
  // list.
  "svg", "path", "g", "line", "rect", "circle", "ellipse", "polygon",
  "polyline", "use", "defs", "title", "desc", "lineargradient",
  "radialgradient", "stop", "clippath", "mask", "pattern", "symbol", "marker",
]);

/**
 * Property keys, spelled the way `hast-util-from-html` produces them.
 *
 * The two sets are deliberately separate. `GLOBAL` is the inert set — names that
 * carry no reference and cannot reach outside the document — and it is short
 * because "this attribute is harmless everywhere" is a strong claim.
 */
const GLOBAL_ATTRS = new Set([
  "className", "id", "title", "style", "dir", "lang", "role",
  "ariaHidden", "ariaLabel", "ariaLabelledBy", "ariaDescribedBy",
  // MathML presentation. Every one of these changes how a glyph is drawn and
  // none of them can reference anything.
  "display", "mathvariant", "stretchy", "accent", "separator", "movablelimits",
  "largeop", "symmetric", "minsize", "maxsize", "form", "fence", "notation",
  "columnalign", "rowalign", "columnspacing", "rowspacing", "linethickness",
  "scriptlevel", "displaystyle", "depth", "voffset", "lspace", "rspace",
  "encoding", "xmlns",
]);

/**
 * Per element, because `href` on a `<span>` or `src` on a `<path>` is not a
 * combination this pipeline produces, and an allowlist that permits a
 * combination nothing writes is an allowlist that cannot be reasoned about.
 */
/**
 * Per element, because `href` on a `<span>` or `src` on a `<path>` is not a
 * combination this pipeline produces, and an allowlist that permits a
 * combination nothing writes is an allowlist that cannot be reasoned about.
 *
 * The SVG names are camelCase because that is what parse5 produced from the
 * document: it normalises `viewbox` to `viewBox` in an SVG subtree, and a list
 * written in the lowercase HTML spelling silently strips them.
 */
const PER_ELEMENT_ATTRS = {
  a: ["href", "target", "rel", "dataFootnoteRef", "dataFootnoteBackref", "ariaDescribedBy"],
  // Deliberately the SAME four the hand-written `normalizeImages` kept. The
  // stored HTML also carries `loading`, `decoding`, a lightbox class list and
  // `data-lightbox` — all of which are for OUR page, none of which mean anything
  // in a reader, and two of which (`data-lightbox`) appear TWICE on 163 images
  // because of the rehype-figure bug that is fixed here but not yet re-rendered
  // into the corpus. A feed carrying one element's controls is a feed carrying
  // noise, so the narrow list stays narrow.
  img: ["src", "alt", "title", "width", "height"],
  input: ["type", "disabled"],
  ol: ["start", "reversed", "type"],
  td: ["colSpan", "rowSpan", "align", "valign"],
  th: ["colSpan", "rowSpan", "align", "valign", "scope"],
  table: ["align", "border", "cellpadding", "cellspacing"],
  section: ["dataFootnotes"],
  sup: ["dataFootnoteRef"],
  li: ["value"],
  pre: ["tabIndex"],
  // SVG geometry. `d` is the path data and `viewBox`/`preserveAspectRatio` are
  // what make a 400000-unit-wide coordinate space scale — drop either and the
  // element renders as a blank box rather than failing visibly.
  svg: ["viewBox", "preserveAspectRatio", "width", "height"],
  path: ["d", "fill", "stroke", "strokeWidth", "transform"],
  use: ["href", "xlinkHref", "x", "y", "width", "height"],
  rect: ["x", "y", "width", "height", "rx", "ry"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  line: ["x1", "y1", "x2", "y2"],
  polygon: ["points"],
  polyline: ["points"],
  stop: ["offset", "stopColor"],
  g: ["transform", "fill", "stroke"],
};

/** URL schemes a feed item may link to. */
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Custom properties that carry a value, plus three named properties.
 *
 * `--shiki-*` has to survive: `defaultColor: false` is what makes Shiki emit
 * `--shiki-light` / `--shiki-dark` instead of a colour (see CLAUDE.md), and the
 * inline value is what a reader with no stylesheet sees. `text-align` and
 * `overflow-x` are `markDisplayMath`'s centring.
 *
 * The VALUE is checked, not just the name. A custom property whose value is
 * `url(…)` is still a custom property, and a browser still fetches the URL.
 */
const STYLE_CUSTOM_PROP = /^--[a-z0-9-]+$/i;
const STYLE_VALUE = /^(#[0-9a-f]{3,8}|[a-z][a-z0-9-]*)$/i;
const STYLE_NAMED = new Map([
  ["text-align", new Set(["left", "right", "center", "justify", "start", "end"])],
  ["overflow-x", new Set(["auto", "hidden", "scroll", "visible"])],
  ["white-space", new Set(["pre", "pre-wrap", "normal", "nowrap"])],
]);

/**
 * Inline elements that are unwrapped rather than deleted.
 *
 * Removing a tag is easy; deciding whether the sentence inside it was the point
 * is not. A stray `<mark>`, `<kbd>` or `<center>` around a phrase is a hazard
 * only as a tag, so the text survives and the element does not. Block-level
 * unknowns are dropped wholesale, because there the children are usually the
 * part that matters — an `<iframe>`, a `<script>`, a `<form>`.
 */
const UNWRAP_ELEMENTS = new Set([
  "mark", "kbd", "samp", "var", "abbr", "cite", "q", "small", "u",
  "ins", "b", "i", "font", "center", "tt", "big", "strike", "nobr",
]);

export function sanitizeFeedHtml(html) {
  if (!html) return "";

  const tree = fromHtml(html, { fragment: true });
  const stack = [tree];

  while (stack.length) {
    const node = stack.pop();
    if (!node || !Array.isArray(node.children)) continue;

    const kept = [];
    for (const child of node.children) {
      if (child.type === "comment" || child.type === "doctype") continue;

      if (child.type !== "element") {
        kept.push(child);
        continue;
      }

      if (!ALLOWED_ELEMENTS.has(child.tagName)) {
        if (UNWRAP_ELEMENTS.has(child.tagName)) {
          child.type = "root";
          child.tagName = undefined;
          child.properties = {};
          kept.push(child);
          stack.push(child);
        }
        continue;
      }

      filterAttributes(child);
      kept.push(child);
      stack.push(child);
    }
    node.children = kept;
  }

  return toHtml(tree, {
    // `<img />` rather than `<img>`: the feed is XHTML-flavoured XML, and the
    // hand-written pass that this replaces existed partly to normalise these.
    closeSelfClosing: true,
  });
}

function filterAttributes(element) {
  const tag = element.tagName;
  const allowed = new Set(GLOBAL_ATTRS);
  for (const name of PER_ELEMENT_ATTRS[tag] ?? []) allowed.add(name);

  const out = {};
  for (const [name, value] of Object.entries(element.properties ?? {})) {
    // Every event handler, without exception and without a list to keep current.
    if (name.startsWith("on")) continue;
    if (!allowed.has(name)) continue;

    // `class` is global because Shiki's `shiki-themes` and KaTeX's `katex` need
    // it — but on an `<img>` the only classes this pipeline produces are
    // `lightbox-image cursor-zoom-in`, which drive OUR page's lightbox and mean
    // nothing in a reader. The previous hand-written pass dropped them too, so
    // keeping them would be a byte-for-byte change to every feed item with a
    // picture for no reader-visible reason. `compare-feeds.mjs` asserts the
    // size, and this is what keeps it honest.
    if (name === "className" && tag === "img") continue;

    if ((name === "href" || name === "src") && !safeUrl(value)) continue;
    if (name === "style" && !safeStyle(value)) continue;

    out[name] = value;
  }

  // `input` is only ever the GFM task-list marker. Anything that is not a
  // disabled checkbox becomes an empty span — an input a reader is invited to
  // operate inside a feed reader is not something this pipeline emits, so it is
  // not something the sanitizer should pass along.
  if (tag === "input") {
    if (String(out.type ?? "").toLowerCase() !== "checkbox") {
      element.tagName = "span";
      element.properties = {};
      return;
    }
    out.type = "checkbox";
    out.disabled = true;
  }

  // Note what is deliberately NOT here: no `target`, no `rel`. A sanitizer's
  // contract is to refuse things, not to have opinions, and rewriting 123 links
  // to open in a new tab would be an editorial decision made in a security
  // function — visible to every reader, and nothing to do with the threat this
  // exists for. `noopener` matters only when `target="_blank"` is present, and
  // the corpus has none; if the author wants one they can write `<a target="_blank">`
  // and it will survive, because `target` is on the allowlist above.

  element.properties = out;
}

function safeUrl(value) {
  const text = String(value ?? "").trim();

  // No scheme at all: a relative reference, which the reader resolves against
  // its OWN base. That is the one thing this function cannot reason about, and
  // `absolutizeUrls` has already rewritten every href and src in this document —
  // so anything still relative came from a form that pass does not handle, and
  // the safe answer for a URL whose target cannot be named is no.
  //
  // Independent of `absolutize`, which passes `mailto:`, `tel:` and `data:`
  // through untouched: the scheme check below is what stops the third of those,
  // and it is why this check exists rather than being folded into that pass.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) return false;

  try {
    return ALLOWED_SCHEMES.has(new URL(text).protocol.toLowerCase());
  } catch {
    return false;
  }
}

function safeStyle(value) {
  const text = String(value ?? "");
  if (!text || /[<>\\]/.test(text)) return false;

  for (const declaration of text.split(";")) {
    const at = declaration.indexOf(":");
    if (at === -1) continue;

    const prop = declaration.slice(0, at).trim();
    const val = declaration.slice(at + 1).trim();
    if (!prop || !val) continue;

    if (STYLE_CUSTOM_PROP.test(prop)) {
      if (!STYLE_VALUE.test(val)) return false;
      continue;
    }

    const allowed = STYLE_NAMED.get(prop.toLowerCase());
    if (!allowed || !allowed.has(val.toLowerCase())) return false;
  }

  return true;
}
