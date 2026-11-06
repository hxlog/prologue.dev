import siteMetadata from "../../data/sitemetadata";
import { absolutize, ogImageUrl } from "./feed/urls";
import { absoluteUrl, SITE_NAME, SITE_URL } from "./seo";

/**
 * JSON-LD builders. Every URL is absolute and every entity is linked by @id so
 * Google can merge the graph across the site-level and page-level scripts.
 */

const PERSON_ID = `${SITE_URL}/#person`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const BLOG_ID = `${SITE_URL}/blog#blog`;
const LANGUAGE = siteMetadata.language || "zh-CN";

function personRef() {
  return { "@id": PERSON_ID };
}

function websiteRef() {
  return { "@id": WEBSITE_ID };
}

function blogRef() {
  return { "@id": BLOG_ID };
}

/** Site-wide graph injected once by the root layout. */
export function siteGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        url: SITE_URL,
        name: SITE_NAME,
        description: siteMetadata.description,
        inLanguage: LANGUAGE,
        publisher: personRef(),
      },
      {
        "@type": "Person",
        "@id": PERSON_ID,
        name: siteMetadata.author,
        url: absoluteUrl("/about"),
        image: absolutize(siteMetadata.avatar),
        description: siteMetadata.authorDesc,
        sameAs: [`https://github.com/${siteMetadata.github}`],
      },
      {
        "@type": "Blog",
        "@id": BLOG_ID,
        url: absoluteUrl("/blog"),
        name: `${SITE_NAME} · 博客`,
        description: siteMetadata.description,
        inLanguage: LANGUAGE,
        isPartOf: websiteRef(),
        publisher: personRef(),
      },
    ],
  };
}

function postImage(post) {
  const custom = String(post.image || "").trim();
  if (custom) return absoluteUrl(custom);
  return ogImageUrl({
    title: post.title,
    date: post.publishDate,
    tags: post.tags || [],
  });
}

/** BlogPosting + the post's breadcrumb, injected by the post route. */
export function blogPostingJsonLd(post) {
  const url = absoluteUrl(`/blog/${post.slugAsParams}`);
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    headline: post.title,
    description: post.description || siteMetadata.description,
    image: [postImage(post)],
    datePublished: post.publishDate,
    dateModified: post.lastmod || post.publishDate,
    author: personRef(),
    publisher: personRef(),
    inLanguage: LANGUAGE,
    isPartOf: blogRef(),
    keywords: (post.tags || []).join(", "),
    articleSection: post.tags?.[0],
    wordCount: post.readingTime?.words,
    timeRequired: `PT${Math.max(1, Math.ceil(post.readingTime?.minutes ?? 1))}M`,
  };
}

/** ProfilePage for /about. */
export function profilePageJsonLd({ title, description, url }) {
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": `${url}#webpage`,
    url,
    name: title,
    description,
    inLanguage: LANGUAGE,
    isPartOf: websiteRef(),
    mainEntity: personRef(),
  };
}

/** Generic WebPage (e.g. /ui). */
export function webPageJsonLd({ title, description, url }) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: title,
    description,
    inLanguage: LANGUAGE,
    isPartOf: websiteRef(),
  };
}

/** Collection pages: /blog, /tags/*, /microblog, /links. */
export function collectionPageJsonLd({ title, description, url, about = true, items = [] }) {
  const list = items
    .map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: /^https?:\/\//i.test(item.path || "") ? item.path : absoluteUrl(item.path),
    }))
    .filter((item) => item.name && item.url);

  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#webpage`,
    url,
    name: title,
    description,
    inLanguage: LANGUAGE,
    isPartOf: websiteRef(),
    ...(about ? { about: blogRef() } : {}),
    ...(list.length
      ? {
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: list.length,
            itemListElement: list,
          },
        }
      : {}),
  };
}

/** BreadcrumbList; items are [{ name, path }] from the home page down. */
export function breadcrumbJsonLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}
