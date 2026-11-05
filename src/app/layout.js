import "./globals.css";
import { Providers } from "../components/providers";
import Navbar from "../components/navbar";
import Footer from "../components/footer";
import Spotlight from "../components/spotlight";
import JsonLd from "../components/json-ld";
import siteMetadata from "../../data/sitemetadata";
import UmamiAnalytics from "../components/umami-analytics";
import Lightbox from "../components/lightbox-controller";
import {
  FEED_TYPES,
  OG_LOCALE,
  SITE_NAME,
  absoluteUrl,
  siteImage,
} from "../lib/seo";
import { siteGraph } from "../lib/structured-data";

/**
 * Typography: system fonts only — this app makes no font requests at all.
 *
 * Two rounds of measurement. First the two Noto SC families were removed: each
 * ships 101 unicode-range slices, a measured Chinese article pulled 33 woff2
 * files totalling 1.9 MB, and because text painted with the fallback and then
 * repainted as slices arrived, every swap was a new LCP candidate (p75 LCP
 * 13.2 s on an article whose HTML was 196 KB).
 *
 * Then the last latin mono (JetBrains Mono, ~40 KB) went too. `display: "swap"`
 * still painted code blocks in the fallback first and swapped them a moment
 * later, which is the same LCP mechanism on every code-heavy article, for a
 * face the reader's OS already has a good enough version of. Code and `.copy-field`
 * now use the platform mono via --font-mono; everything else uses --font-sans,
 * so the whole site is one typographic voice on every OS.
 *
 * Do not add a webfont back without re-measuring LCP — the swap repaint is the
 * mechanism, not the byte count.
 */

const COVER = siteImage();

export const metadata = {
  metadataBase: new URL(siteMetadata.siteUrl),
  generator: "Next.js",
  applicationName: SITE_NAME,
  referrer: "origin-when-cross-origin",
  keywords: siteMetadata.keywords,
  authors: [{ name: siteMetadata.author, url: absoluteUrl("/about") }],
  creator: siteMetadata.author,
  publisher: siteMetadata.publishName,
  /* The suffix lives here once. Every page passes its raw title to
     buildMetadata(); a page that sets an absolute title opts out. */
  title: {
    default: siteMetadata.title,
    template: `%s - ${SITE_NAME}`,
  },
  description: siteMetadata.description,
  alternates: {
    types: FEED_TYPES,
  },
  formatDetection: {
    email: true,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: siteMetadata.title,
    description: siteMetadata.description,
    url: absoluteUrl("/"),
    siteName: SITE_NAME,
    locale: OG_LOCALE,
    type: "website",
    images: [COVER],
  },
  twitter: {
    card: "summary_large_image",
    title: siteMetadata.title,
    description: siteMetadata.description,
    images: { url: COVER.url, alt: COVER.alt },
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang={siteMetadata.language} suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        <JsonLd data={siteGraph()} />
        <Providers>
          <a href="#content" className="skip-link">
            跳到正文
          </a>
          <Navbar />
          <div className="shell">
            <main id="content">{children}</main>
            <Footer />
          </div>
          {/* The lightbox controller is a ~1 KB client component with one
              delegated listener; the viewer itself is a separate chunk that is
              only warmed on pointer intent. It reads the DOM at click time (not
              at render time), so it needs no pathname and no Suspense boundary
              — the layout stays prerenderable with nothing to resolve. */}
          <Lightbox />
          {/* One delegated pointermove listener for every .card-spotlight. */}
          <Spotlight />
        </Providers>
        <UmamiAnalytics />
      </body>
    </html>
  );
}
