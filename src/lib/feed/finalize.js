import siteMetadata from "../../../data/sitemetadata";
import { getPublishedPostsWithContent } from "../content/posts";
import { coverImageUrl, postUrl } from "./urls";

/**
 * Post-processing applied to the serialized feeds to satisfy fields the `feed`
 * library cannot express through its shared item model:
 *
 *   - RSS: inject <dc:creator> per item. The library emits <author> (an email
 *     form), but the Folo Feed Spec reads the author from dc:creator.
 *   - JSON Feed: add a per-item `image` (string URL). The library would only
 *     emit it from item.image, but that field also drives the RSS enclosure
 *     (forcing length=0), so we attach the JSON thumbnail here instead.
 */

const CREATOR = siteMetadata.author;

/**
 * URL -> cover image, built per call rather than at module scope.
 *
 * The previous version computed this map once at import time from the whole
 * Contentlayer array. That is not available outside a request now, and more to
 * the point a module-scope map would be frozen for the life of the process —
 * a publish would leave the JSON feed pointing at the old cover indefinitely.
 */
async function coverImages() {
  const posts = await getPublishedPostsWithContent();
  const map = {};
  for (const post of posts) map[postUrl(post.slug)] = coverImageUrl(post);
  return map;
}

/** Inject <dc:creator> into every RSS <item> (Folo author source). */
export function finalizeRss(xml) {
  const creator = `<dc:creator><![CDATA[${CREATOR}]]></dc:creator>`;
  return xml.replace(/<\/item>/g, `${creator}</item>`);
}

/** Add a per-item `image` URL to the JSON Feed (Folo thumbnail source). */
export async function finalizeJson(jsonString) {
  const feed = JSON.parse(jsonString);
  if (!Array.isArray(feed.items)) return jsonString;

  const images = await coverImages();

  feed.items = feed.items.map((item) => {
    if (!item.image && images[item.id]) {
      return { ...item, image: images[item.id] };
    }
    return item;
  });
  return JSON.stringify(feed, null, 2);
}
