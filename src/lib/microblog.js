import fs from "fs";
import path from "path";
import { load } from "js-yaml";

/**
 * Microblog data access + normalization.
 *
 * Schema (data/microblog.yaml), backward compatible with old {date, content}
 * entries — a Weibo/Zhihu-style entry supports multiple text paragraphs and
 * multiple captioned images:
 *
 *   - date: 2026-03-14
 *     content: |
 *       First paragraph…
 *
 *       Second paragraph…        (blank line = new paragraph)
 *     images:
 *       - src: /static/microblog/a.jpg
 *         desc: caption           (optional; shown in the lightbox)
 *       - /static/microblog/b.jpg (plain-string shorthand)
 *
 * Normalized entry: { id, date, paragraphs[], images[{src, desc}] }.
 * `id` is stable (date + index) and used for page anchors and RSS guids.
 */
export function getMicroblog() {
  const filePath = path.join(process.cwd(), "data", "microblog.yaml");
  const raw = fs.readFileSync(filePath, "utf8");
  const entries = load(raw) || [];

  return entries
    .map((entry, index) => normalize(entry, index))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function normalize(entry, index) {
  const paragraphs = String(entry.content || "")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean);

  const images = (entry.images || []).map((img) =>
    typeof img === "string" ? { src: img, desc: "" } : { src: img.src, desc: img.desc || "" }
  );

  const dateKey = String(entry.date || "").slice(0, 10).replace(/-/g, "");
  return {
    id: `mb-${dateKey}-${index}`,
    date: entry.date,
    paragraphs,
    images,
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

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
