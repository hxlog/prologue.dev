/**
 * Post-processing applied to the serialized feeds to satisfy fields the `feed`
 * library cannot express through its shared item model:
 *
 *   - Atom: declare the feed language, emit the feed image as foreign markup
 *     that Folo's Atom path reads, and normalise a non-standard enclosure MIME.
 *   - RSS: make guid a permalink, remove the native <author> that duplicates
 *     dc:creator, and keep dc:creator as the Folo author source.
 *   - JSON Feed: upgrade to 1.1, add language/favicon/authors, and add a
 *     per-item image (string URL) when the post has no local cover.
 *
 * All transformations are string-level and intentionally feed-only.
 */
import { getPosts } from "../content";
import siteMetadata from "../../../data/sitemetadata";
import { coverImageUrl, postUrl, siteUrl } from "./urls";

const CREATOR = siteMetadata.author;
const SITE = siteUrl();
const LANGUAGE = String(siteMetadata.language || "zh-CN");

/**
 * The Atom feed image, emitted as namespaced foreign markup.
 *
 * Atom only standardises <logo>/<icon>, and Folo's documented Atom parser does
 * not map either of them to its feed image. Its feed-level custom field list is
 * ["follow_challenge", "subtitle", "image"], so a feed child named `image` is
 * read exactly like the RSS <image> block (url/title/link). An unknown namespace
 * is the only way to add it without breaking Atom's reserved namespace, and it
 * degrades to "ignored foreign markup" (RFC 4287 §6.1) for every other reader.
 */
const ATOM_IMAGE_NS = "https://folo.is/ns";

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function atomFeedImage() {
  return [
    `  <image xmlns="${ATOM_IMAGE_NS}">`,
    `    <url>${escapeXml(`${SITE}${siteMetadata.avatar}`)}</url>`,
    `    <title>${escapeXml(siteMetadata.title)}</title>`,
    `    <link>${escapeXml(`${SITE}/`)}</link>`,
    "  </image>",
  ].join("\n");
}

/**
 * Cover URL per post URL, for the JSON Feed thumbnails.
 *
 * A function rather than a module constant: `next dev` re-reads the content
 * tree when it changes, and a module-scope map built from the first snapshot
 * would keep answering with it. Called once per feed serialization.
 */
function imageByUrl() {
  const map = {};
  for (const post of getPosts()) {
    if (post.draft === false) map[postUrl(post.slug)] = coverImageUrl(post);
  }
  return map;
}

/**
 * Atom post-processing: declare the feed language, add the Folo-readable feed
 * image, and fix the enclosure MIME the `feed` library derives from the file
 * extension (.jpg becomes image/jpg, which is not an IANA type).
 *
 * The <image> block is emitted once, right after the <feed> start tag, and is
 * guarded by its namespace so re-running the finalizer is a no-op.
 */
export function finalizeAtom(xml) {
  let out = String(xml).replace(/<feed\b([^>]*)>/, (match, attrs) => {
    if (/\bxml:lang\s*=/.test(attrs)) return match;
    return `<feed${attrs} xml:lang="${LANGUAGE.replace(/"/g, "&quot;")}">`;
  });

  if (!out.includes(`<image xmlns="${ATOM_IMAGE_NS}">`)) {
    out = out.replace(/(<feed\b[^>]*>)/, (match) => `${match}\n${atomFeedImage()}`);
  }

  // Only enclosure links are rewritten; the body HTML lives in CDATA and is
  // never touched by this replace.
  return out.replace(/<link\b[^>]*\brel="enclosure"[^>]*>/g, (tag) =>
    tag.replace(/\btype="image\/jpg"/g, 'type="image/jpeg"')
  );
}

/** Remove item-level <author> elements without touching CDATA contents. */
function removeAuthorTags(xml) {
  return xml.replace(/\s*<author>[\s\S]*?<\/author>/g, "");
}

function removeItemAuthors(inner) {
  let out = "";
  let cursor = 0;

  while (cursor < inner.length) {
    const cdataStart = inner.indexOf("<![CDATA[", cursor);
    if (cdataStart === -1) {
      out += removeAuthorTags(inner.slice(cursor));
      break;
    }

    out += removeAuthorTags(inner.slice(cursor, cdataStart));
    const cdataEnd = inner.indexOf("]]>", cdataStart + 9);
    if (cdataEnd === -1) {
      out += inner.slice(cdataStart);
      break;
    }

    out += inner.slice(cdataStart, cdataEnd + 3);
    cursor = cdataEnd + 3;
  }

  return out;
}

/** Make RSS guid a permalink and keep only dc:creator for the author. */
export function finalizeRss(xml) {
  const creator = `<dc:creator><![CDATA[${CREATOR}]]></dc:creator>`;

  return String(xml)
    .replace(
      /<guid\b([^>]*?)\bisPermaLink="false"/g,
      '<guid$1isPermaLink="true"'
    )
    .replace(/<item>([\s\S]*?)<\/item>/g, (_match, inner) => {
      return `<item>${removeItemAuthors(inner)}${creator}</item>`;
    });
}

/** Upgrade the JSON Feed to 1.1 and fill its optional author/language fields. */
export function finalizeJson(jsonString) {
  const feed = JSON.parse(jsonString);
  const avatar = `${SITE}${siteMetadata.avatar}`;

  feed.version = "https://jsonfeed.org/version/1.1";
  feed.language = LANGUAGE;
  feed.favicon = `${SITE}${siteMetadata.favicon}`;

  if (feed.author) {
    feed.authors = [{ ...feed.author, avatar }];
    delete feed.author;
  }

  if (Array.isArray(feed.items)) {
    const images = imageByUrl();
    feed.items = feed.items.map((item) => {
      let next = item;

      if (item.author) {
        next = { ...next, authors: [item.author] };
        delete next.author;
      }
      if (!next.image && images[next.id]) {
        next = { ...next, image: images[next.id] };
      }
      return next;
    });
  }

  return JSON.stringify(feed, null, 2);
}
