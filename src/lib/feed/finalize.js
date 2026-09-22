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
import { allPosts } from "../content";
import siteMetadata from "../../../data/sitemetadata";
import { coverImageUrl, postUrl } from "./urls";

const CREATOR = siteMetadata.author;

const IMAGE_BY_URL = (() => {
  const map = {};
  for (const post of allPosts) {
    if (post.draft === false) map[postUrl(post.slug)] = coverImageUrl(post);
  }
  return map;
})();

/** Inject <dc:creator> into every RSS <item> (Folo author source). */
export function finalizeRss(xml) {
  const creator = `<dc:creator><![CDATA[${CREATOR}]]></dc:creator>`;
  return xml.replace(/<\/item>/g, `${creator}</item>`);
}

/** Add a per-item `image` URL to the JSON Feed (Folo thumbnail source). */
export function finalizeJson(jsonString) {
  const feed = JSON.parse(jsonString);
  if (Array.isArray(feed.items)) {
    feed.items = feed.items.map((item) => {
      if (!item.image && IMAGE_BY_URL[item.id]) {
        return { ...item, image: IMAGE_BY_URL[item.id] };
      }
      return item;
    });
  }
  return JSON.stringify(feed, null, 2);
}
