/**
 * A CodeMirror 6 theme built from the blog's own design tokens.
 *
 * Every colour here is a `var(--…)` reference, not a literal. That is the point:
 * /studio is the same application as the blog, so it must repaint when `.dark`
 * flips and when a token is retuned — and a hard-coded hex would be a second
 * palette that silently drifts from the first.
 *
 * CodeMirror's own `oneDark` was rejected for this reason, not for its taste:
 * adopting it would mean the editor is the one surface where the site's cyan
 * accent does not apply.
 */

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * The chrome: gutters, cursor, selection, active line.
 *
 * `backgroundColor: transparent` on the editor root is deliberate — the panel
 * behind it already supplies `--surface`, and painting it again here would show
 * as a rectangle one token off from the card it sits in.
 */
export const prologueTheme = EditorView.theme(
  {
    "&": {
      color: "var(--foreground)",
      backgroundColor: "transparent",
      fontSize: "14px",
      // A floor, not a height. A new post has an empty document, and CodeMirror
      // sizes itself to its content — so without this the editor for a post the
      // author has not written yet is one line tall, a 40px sliver with a
      // border, which reads as "this did not load". The measurement is roughly
      // a third of a laptop viewport and a comfortable phone screenful; a long
      // document still grows past it and scrolls with the page.
      minHeight: "42vh",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-content": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.75",
      padding: "12px 0",
      // CJK text has no spaces to break at, so a long paragraph would otherwise
      // force a horizontal scrollbar across the whole document.
      wordBreak: "break-word",
      caretColor: "var(--accent)",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      overflow: "auto",
    },
    ".cm-line": { padding: "0 16px" },

    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--faint)",
      border: "none",
      paddingLeft: "4px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 8px 0 12px",
      fontSize: "12px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--accent-soft)",
      color: "var(--accent)",
    },
    ".cm-activeLine": { backgroundColor: "var(--accent-soft)" },

    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
      { backgroundColor: "var(--secondary-soft)" },
    ".cm-selectionMatch": { backgroundColor: "var(--accent-soft)" },
    ".cm-searchMatch": {
      backgroundColor: "var(--secondary-soft)",
      outline: "1px solid var(--secondary)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "var(--secondary)",
      color: "#fff",
    },

    ".cm-foldPlaceholder": {
      backgroundColor: "var(--surface-3)",
      border: "none",
      color: "var(--muted)",
      padding: "0 6px",
      borderRadius: "4px",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      boxShadow: "var(--shadow-pop)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--accent-soft)",
      color: "var(--accent-strong)",
    },
    ".cm-panels": {
      backgroundColor: "var(--surface-2)",
      color: "var(--foreground)",
      border: "none",
    },
    ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
    ".cm-textfield": {
      backgroundColor: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "6px",
      color: "var(--foreground)",
    },
    ".cm-button": {
      backgroundColor: "var(--surface-3)",
      backgroundImage: "none",
      border: "1px solid var(--border)",
      borderRadius: "6px",
      color: "var(--foreground)",
    },
  },
  { dark: false }
);

/**
 * Markdown syntax colours.
 *
 * Weight and style carry as much of the signal as colour does, which is what
 * keeps this legible for the two most common markdown marks: a heading is bold
 * and larger, emphasis is italic, a code span is monospaced — all of which
 * survive a colourblind reader and a greyscale screenshot.
 */
export const prologueHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.5em", fontWeight: "700", color: "var(--foreground)" },
  { tag: t.heading2, fontSize: "1.3em", fontWeight: "700", color: "var(--foreground)" },
  { tag: t.heading3, fontSize: "1.15em", fontWeight: "600", color: "var(--foreground)" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "600", color: "var(--foreground)" },

  { tag: t.strong, fontWeight: "700", color: "var(--foreground)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--faint)" },

  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: t.url, color: "var(--accent-strong)", textDecoration: "underline" },

  { tag: t.monospace, color: "var(--secondary-strong)" },
  { tag: t.quote, color: "var(--muted)", fontStyle: "italic" },

  // Markup punctuation — the fence markers, the `**`, the `>`. Faint on
  // purpose: the author is reading prose, and the syntax should recede until
  // the cursor is in it.
  { tag: t.processingInstruction, color: "var(--faint)" },
  { tag: t.contentSeparator, color: "var(--faint)" },
  { tag: t.list, color: "var(--accent)" },
  { tag: t.labelName, color: "var(--secondary)" },

  { tag: t.comment, color: "var(--faint)", fontStyle: "italic" },
  { tag: t.keyword, color: "var(--secondary-strong)" },
  { tag: t.string, color: "var(--accent-strong)" },
  { tag: t.number, color: "var(--secondary)" },
  { tag: [t.bool, t.null], color: "var(--secondary)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--accent-strong)" },
  { tag: [t.variableName, t.propertyName], color: "var(--foreground)" },
  { tag: t.typeName, color: "var(--accent-strong)" },
  { tag: t.operator, color: "var(--muted)" },
  { tag: t.invalid, color: "#ef4444" },
]);

/** Both together, as the extension list the editor takes. */
export const prologueSyntaxTheme = [prologueTheme, syntaxHighlighting(prologueHighlight)];
