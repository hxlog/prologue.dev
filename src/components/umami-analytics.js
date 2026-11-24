import Script from "next/script";
import siteMetadata from "../../data/sitemetadata";
import UmamiRecorderLazy from "./umami-recorder-lazy";

/**
 * Self-hosted Umami. Production only.
 *
 * The pageview + web-vitals script is `lazyOnload`: it is not part of the first
 * paint and used to be preloaded from <head>, where it competed with the
 * article's own bytes for bandwidth. Umami reads web vitals from the browser's
 * buffered PerformanceEntry list, so deferring the script does not lose LCP /
 * INP / CLS -- it only stops the measurement from slowing the thing it measures.
 *
 * The separate session-replay recorder is interaction-gated (see
 * umami-recorder-lazy.js) because it is another ~58 KB of scripting on every
 * visit that Lighthouse measures as blocking work.
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
      <UmamiRecorderLazy src={umami.recorderUrl} websiteId={umami.websiteId} />
    </>
  );
}
