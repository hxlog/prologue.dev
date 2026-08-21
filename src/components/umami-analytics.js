import Script from "next/script";
import siteMetadata from "../../data/sitemetadata";

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
        strategy="afterInteractive"
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
