/**
 * HTML serialization for microblog entries (used by the microblog RSS feed).
 *
 * Split out of the old src/lib/microblog.js, which also read and normalised
 * data/microblog.yaml. The data now comes from the `microblog` collection
 * (src/lib/content/collections.js); this is the one piece of that module that
 * was about output rather than input, and it is unchanged.
 */

/** Escape text for interpolation into HTML. Entries are author-written, but
 *  escaping here is what keeps an accidental `<` from breaking the feed. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a normalized entry (`{paragraphs[], images[{src, desc}]}`) as HTML:
 * one <p> per paragraph, one <figure> per image.
 *
 * @param {object} entry
 * @param {(src: string) => string} absolutize - relative path -> absolute URL
 */
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
