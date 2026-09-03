import siteMetadata from "../../data/sitemetadata";

export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/_next/', '/og'],
    },
    sitemap: `${siteMetadata.siteUrl}/sitemap.xml`,
  };
}
