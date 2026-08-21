import "./globals.css";
import dynamic from "next/dynamic";
import { Providers } from "../components/providers";
import Navbar from "../components/navbar";
import Footer from "../components/footer";
import siteMetadata from "../../data/sitemetadata";
import UmamiAnalytics from "../components/umami-analytics";

const ImageLightbox = dynamic(() => import("../components/ImageLightbox"));

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
    <html lang={siteMetadata.language} suppressHydrationWarning>
      <body className="mx-auto bg-white dark:bg-black selection:bg-[#d7ffff] dark:selection:bg-[#006482a2]">
        <Providers>
          <Navbar />
          <div className="max-w-7xl mx-auto px-6">
            <main>{children}</main>
            <Footer />
          </div>
          <ImageLightbox />
        </Providers>
        <UmamiAnalytics />
      </body>
    </html>
  );
}
