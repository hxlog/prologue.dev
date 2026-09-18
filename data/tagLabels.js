/**
 * Tag display labels.
 *
 * Canonical tag slugs stay English (stable URLs, feeds, analytics — raw
 * `/tags/${tag}` interpolation assumes ASCII), while the UI renders Chinese
 * labels. The database is now the source of truth (`tags.label`, editable in
 * /studio); this file is the fallback for tags that have not been imported and
 * for the small number of components that render a label without a database
 * round-trip.
 *
 * Keep this in sync with the `tags` table only when adding a tag inline; a tag
 * created in /studio needs no change here.
 */
const tagLabels = {
  Economics: "经济学",
  Finance: "金融",
  Quant: "数据科学",
  Crypto: "加密货币",
  AI: "人工智能",
  Sociology: "社会学",
  Capitalism: "资本主义",
  Education: "教育",
  Inequality: "不平等",
  Politics: "政治",
  Philosophy: "哲学",
  Technology: "技术",
  Meta: "随笔",
  Translations: "翻译",
  Gender: "性别",
};

/** Chinese label for a tag slug, falling back to the slug itself. */
export function tagLabel(tag) {
  return tagLabels[tag] || tag;
}

export default tagLabels;
