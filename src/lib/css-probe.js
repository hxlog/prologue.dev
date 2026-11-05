/**
 * Read the design tokens out of the RUNNING stylesheet.
 *
 * The /ui standards page must never restate a colour or a size that could
 * drift from globals.css: every swatch and every number on it is produced by
 * asking the browser what `var(--token)` resolves to right now, in the :root
 * scope and in the .dark scope. This file is the thin layer that does the
 * asking and is only imported by the page's client components.
 *
 * The scopes are built from CSSOM, not by toggling the page theme: the page
 * shows light and dark side by side, so it cannot rely on whichever class
 * <html> happens to carry at that moment.
 */

/** Parse a computed color string (rgb/rgba) into channels. */
function parseColor(value) {
  if (!value) return null;
  const match = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [r, g, b, a = 1] = parts;
  return { r, g, b, a };
}

/** Hex for an opaque color, else the rgba() string. */
export function formatColor(color) {
  if (!color) return "—";
  if (color.a >= 0.999) {
    const hex = [color.r, color.g, color.b]
      .map((v) => Math.round(v).toString(16).padStart(2, "0"))
      .join("");
    return `#${hex}`;
  }
  return `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)} / ${color.a.toFixed(2)})`;
}

/** Composite a possibly-transparent foreground over an opaque background. */
export function compositeOver(fg, bg) {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/** WCAG relative luminance. */
function luminance({ r, g, b }) {
  const [rr, gg, bb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
}

/** WCAG contrast ratio between two opaque colors. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A hidden element inside `scope` that inherits its custom properties. */
function hiddenProbe(scope) {
  const el = document.createElement("span");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;contain:strict;";
  scope.append(el);
  return el;
}

/** var(--name) resolved to a computed color inside `scope`. */
export function resolveColor(scope, varName) {
  if (!scope) return null;
  const el = hiddenProbe(scope);
  el.style.color = `var(${varName})`;
  const value = getComputedStyle(el).color;
  el.remove();
  return parseColor(value);
}

/** var(--name) used as `property`, read back as the browser computed it. */
export function resolveValue(scope, property, varName) {
  if (!scope) return "";
  const el = hiddenProbe(scope);
  el.style.setProperty(property, `var(${varName})`);
  const value = getComputedStyle(el).getPropertyValue(property).trim();
  el.remove();
  return value;
}

/** Raw custom-property text (a bare triplet, a #hex, a gradient, a time). */
export function readVar(scope, varName) {
  if (!scope) return "";
  return getComputedStyle(scope).getPropertyValue(varName).trim();
}

function walkRules(rules, visit) {
  for (const rule of Array.from(rules)) {
    visit(rule);
    // @layer / @media / @supports groups carry nested style rules.
    if (rule.cssRules) walkRules(rule.cssRules, visit);
  }
}

/**
 * Collect every custom property declared by rules whose selector list contains
 * `selector` (:root or .dark) and apply them to `el` as inline custom
 * properties, so the element becomes a self-contained theme scope.
 */
export function scopeTheme(el, selector) {
  if (!el) return new Map();
  const decls = new Map();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet — none on this site
    }
    if (!rules) continue;
    walkRules(rules, (rule) => {
      if (!rule.selectorText || !rule.style) return;
      const selectors = rule.selectorText.split(",").map((s) => s.trim());
      if (!selectors.includes(selector)) return;
      for (const prop of Array.from(rule.style)) {
        if (!prop.startsWith("--")) continue;
        decls.set(prop, rule.style.getPropertyValue(prop).trim());
      }
    });
  }
  for (const [prop, value] of decls) el.style.setProperty(prop, value);
  return decls;
}
