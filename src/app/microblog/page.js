import PageTransition from "../../components/page-transition";
import RouteTransition from "../../components/route-transition";
import MicroblogTimeline from "../../components/microblog-timeline";
import { getMicroblog } from "../../lib/microblog";
import JsonLd from "../../components/json-ld";
import {
  breadcrumbJsonLd,
  collectionPageJsonLd,
} from "../../lib/structured-data";
import {
  FEED_TYPES,
  absoluteUrl,
  buildMetadata,
  defaultOgImage,
} from "../../lib/seo";
import siteMetadata from "../../../data/sitemetadata";

export async function generateMetadata() {
  return buildMetadata({
    title: siteMetadata.pages.microblog.title,
    description: siteMetadata.pages.microblog.description,
    path: "/microblog",
    type: "website",
    image: defaultOgImage(siteMetadata.pages.microblog.title),
    feedTypes: {
      ...FEED_TYPES,
      "application/rss+xml": [
        { url: absoluteUrl("/rss"), title: "RSS" },
        { url: absoluteUrl("/microblog/rss"), title: "微博 RSS" },
      ],
    },
  });
}

/* Cache Components gates (Next 16.4).
   - instant = true: assert that a navigation into this route paints UI
     immediately. Validation runs in development and names the component that
     would block it; the build is unaffected.
   - ensureStatic = "shell": the App Shell for this route must stay prerendered
     at build time. It is a ratchet against a later change quietly turning the
     route request-rendered — the failure mode is a build error, not a slow
     page nobody measures. */
export const instant = true;
export const ensureStatic = "shell";

export default async function MicroblogPage() {
  const entries = getMicroblog();
  const page = siteMetadata.pages.microblog;
  const url = absoluteUrl("/microblog");

  return (
    <RouteTransition>
      <JsonLd
        data={collectionPageJsonLd({
          title: page.title,
          description: page.description,
          url,
          about: false,
          items: entries.map((entry) => ({
            name: (entry.paragraphs[0] || "微博").slice(0, 80),
            path: `/microblog#${entry.id}`,
          })),
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "首页", path: "/" },
          { name: page.heading, path: "/microblog" },
        ])}
      />
      <PageTransition className="mx-auto max-w-2xl py-8">
        <header>
          <p className="eyebrow">Microblog</p>
          <h1 className="mt-2 text-h1 font-semibold tracking-tight text-foreground">
            {page.heading}
          </h1>
          <p className="mt-2 pb-8 text-sm text-muted">
            {page.description}
          </p>
        </header>
        <MicroblogTimeline entries={entries} />
      </PageTransition>
    </RouteTransition>
  );
}
