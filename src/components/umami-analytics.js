import Script from "next/script";
import siteMetadata from "../../data/sitemetadata";

/**
 * Self-hosted Umami. Production only.
 *
 * Both tags are `lazyOnload`: the analytics script is not part of the first
 * paint and used to be preloaded from <head>, where it competed with the
 * article's own bytes for bandwidth. Umami reads web vitals from the browser's
 * buffered PerformanceEntry list, so deferring the script does not lose LCP /
 * INP / CLS -- it only stops the measurement from slowing the thing it measures.
 */
export default function UmamiAnalytics() {
  const { umami } = siteMetadata;
  if (process.env.NODE_ENV !== "production" || !umami?.websiteId) {
    return null;
  }

  return (
    <>
      <Script
        id="umami-script"
        src={umami.scriptUrl}
        data-website-id={umami.websiteId}
        data-domains={umami.domains}
        data-do-not-track="true"
        data-exclude-search="true"
        data-performance="true"
        strategy="lazyOnload"
      />
      <Script
        id="umami-recorder"
        src={umami.recorderUrl}
        data-website-id={umami.websiteId}
        strategy="lazyOnload"
      />
    </>
  );
}
