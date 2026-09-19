import "./globals.css";
import { Noto_Sans_SC, Noto_Serif_SC, JetBrains_Mono } from "next/font/google";
import { Providers } from "../components/providers";
import siteMetadata from "../../data/sitemetadata";

/**
 * The root layout is deliberately thin: document shell, fonts, theme.
 *
 * The public chrome (navbar, footer, lightbox, analytics) lives in
 * src/app/(site)/layout.js instead, because a root layout wraps *every* route
 * including /studio — and /studio must not render the blog's navigation, must
 * not mount the image lightbox, and must not report its own pageviews to
 * Umami. Before this split the only way to have an admin area was to render
 * the public navbar on top of it.
 */

/**
 * Typography stack (next/font best practice: self-hosted, zero layout shift,
 * unicode-range subsetting keeps CJK payloads small):
 * - Noto Sans SC  → UI + headings + body (--font-sans)
 * - Noto Serif SC → editorial accents: excerpts, quotes (--font-serif)
 * - JetBrains Mono → code, terminal widget, copy fields (--font-mono)
 */
const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  variable: "--font-noto-sans-sc",
  display: "swap",
});

const notoSerifSC = Noto_Serif_SC({
  subsets: ["latin"],
  variable: "--font-noto-serif-sc",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata = {
  metadataBase: new URL(siteMetadata.siteUrl),
  generator: "Next.js",
  applicationName: siteMetadata.siteRepo,
  referrer: "origin-when-cross-origin",
  keywords: siteMetadata.keywords,
  authors: [{ name: siteMetadata.author, url: "/about" }],
  creator: siteMetadata.author,
  publisher: siteMetadata.publishName,
  title: siteMetadata.title,
  description: siteMetadata.description,
  alternates: {
    canonical: "/",
    types: {
      "application/rss+xml": "/rss",
      "application/atom+xml": "/atomfeed",
      "application/feed+json": "/jsonfeed",
    },
  },
  formatDetection: {
    email: true,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: siteMetadata.title,
    description: siteMetadata.description,
    url: siteMetadata.siteUrl,
    siteName: siteMetadata.siteName,
    locale: siteMetadata.language,
  },
};

export default function RootLayout({ children }) {
  return (
    <html
      lang={siteMetadata.language}
      suppressHydrationWarning
      className={`${notoSansSC.variable} ${notoSerifSC.variable} ${jetbrainsMono.variable}`}
    >
      <body className="mx-auto bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
