/**
 * Tag display labels.
 *
 * Canonical tag slugs stay English (stable URLs, feeds, analytics — raw
 * `/tags/${tag}` interpolation assumes ASCII), while the UI renders labels from
 * this map. Single source of truth for every tag consumer: cards, tag chips,
 * the tag sidebar, tag page headers, the Fuse search index and related posts.
 *
 * English by default so the starter reads coherently out of the box. A
 * non-English site can translate the values freely — translate Chinese, or any
 * other language. The KEYS are the tag slugs used in post frontmatter and in
 * `/tags/<slug>` URLs, so those should stay ASCII; only the values change.
 */
const tagLabels = {
  Economics: "Economics",
  Finance: "Finance",
  Quant: "Data Science",
  Crypto: "Crypto",
  AI: "AI",
  Sociology: "Sociology",
  Capitalism: "Capitalism",
  Education: "Education",
  Inequality: "Inequality",
  Politics: "Politics",
  Philosophy: "Philosophy",
  Technology: "Technology",
  Meta: "Notes",
  Translations: "Translations",
  Gender: "Gender",
  starter: "Starter",
  hello: "Hello",
};

export function tagLabel(tag) {
  return tagLabels[tag] || tag;
}

export default tagLabels;
