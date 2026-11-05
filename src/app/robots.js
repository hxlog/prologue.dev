import siteMetadata from "../../data/sitemetadata";

export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/'],
    },
    sitemap: `${siteMetadata.siteUrl}/sitemap.xml`,
  };
}
