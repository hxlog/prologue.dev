import { visit } from "unist-util-visit";

/**
 * Wrap every GFM table in a horizontally scrollable region.
 *
 * A markdown table becomes a bare <table> in the article HTML. The typography
 * plugin sizes it `width: 100%; table-layout: auto`, so its min-content width
 * can exceed a 320px viewport — the page, not the table, then scrolls
 * sideways. Wrapping the table in `div.table-scroll` (styled in globals.css)
 * keeps the overflow inside the region and fixes the page-level horizontal
 * scrollbar at every phone width.
 *
 * The wrapper is a labelled, focusable region (`role="region"`, tabindex 0,
 * aria-label) so keyboard users can focus it and scroll it with the arrow keys;
 * VoiceOver/NVDA announce it as a table region. It is part of the build-time
 * HTML, so the no-JS/static-export contract keeps working.
 *
 * Runs in src/lib/content/pipeline.js. Never wraps twice: a table already
 * inside `.table-scroll` (a second pass over the same tree) is left alone.
 */
const TABLE_SCROLL_CLASS = "table-scroll";

export default function rehypeTableWrap() {
  return (tree) => {
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "table") return;
      if (!parent || typeof index !== "number") return;
      // Do not wrap a table that is already inside the scroll region. This also
      // stops the visitor from wrapping its own output if it ever visits the
      // replacement (the traversal descends into the table, not into the new
      // wrapper, but the guard keeps the plugin safe to run twice).
      if (isInsideTableScroll(parent)) return;

      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: {
          className: [TABLE_SCROLL_CLASS],
          role: "region",
          tabIndex: 0,
          // hast property name for aria-label (property-information maps it to
          // the aria-label attribute in the output).
          ariaLabel: "表格",
        },
        children: [node],
      };
    });
  };
}

function hasTableScrollClass(node) {
  const className = node.properties?.className;
  if (!className) return false;
  const classes = Array.isArray(className) ? className : [className];
  return classes.includes(TABLE_SCROLL_CLASS);
}

function isInsideTableScroll(parent) {
  return parent.type === "element" && hasTableScrollClass(parent);
}
