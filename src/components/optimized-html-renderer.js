import ResponsiveImage from "./responsive-image";
import { MermaidBlock } from "./mermaid-block";
import { decodeHtmlEntities } from "../lib/html-entities";
import { IMAGE_SOURCES } from "../../data/image-sources.js";

/**
 * Split post HTML into React nodes: ResponsiveImage for <img>, MermaidBlock for
 * <pre class="mermaid">, and dangerouslySetInnerHTML for everything else.
 *
 * The width/height come from the attributes rehype-figure writes (it reads the
 * real pixel size with sharp at render time). This used to hard-code 1920x1080
 * for every image, which reserved a 16:9 box for every 4:3 screenshot: the
 * element was 639x360 before load and 639x510 after, so every article shifted
 * its text as the reader scrolled into an image. Passing the true intrinsic
 * size is what makes the reserved box match the bitmap.
 */
export function OptimizedHTMLRenderer({ htmlContent }) {
  const processHTML = (html) => {
    const parts = [];
    const tokenRegex =
      /<img\s+([^>]*?)\/?>|<pre\b([^>]*\bclass=["'][^"']*\bmermaid\b[^"']*["'][^>]*)>([\s\S]*?)<\/pre>/gi;
    let lastIndex = 0;
    let match;
    let keyIndex = 0;

    while ((match = tokenRegex.exec(html)) !== null) {
      const matchIndex = match.index;

      if (matchIndex > lastIndex) {
        parts.push(
          <div
            key={`html-${keyIndex++}`}
            dangerouslySetInnerHTML={{
              __html: html.substring(lastIndex, matchIndex),
            }}
          />
        );
      }

      if (match[0].startsWith("<img")) {
        const attributes = match[1] || "";
        const attr = (name) => {
          const found = attributes.match(new RegExp(`\\b${name}=["']([^"']*?)["']`, "i"));
          return found ? found[1] : "";
        };
        const src = attr("src");
        const width = Number.parseInt(attr("width"), 10);
        const height = Number.parseInt(attr("height"), 10);
        const eager = /\bloading=["']eager["']/i.test(attributes);
        // rehype-figure owns the priority policy: the first body image is
        // eager, and only a non-heavy one also gets fetchpriority="high" (a
        // 4.7 MB first image as the high-priority candidate was a multi-second
        // LCP). Pass the decision through instead of forcing "high" onto
        // every eager image.
        const fetchPriorityAttr = attr("fetchpriority");

        if (src) {
          parts.push(
            <ResponsiveImage
              key={`img-${keyIndex++}`}
              src={src}
              alt={attr("alt")}
              width={Number.isFinite(width) && width > 0 ? width : 1600}
              height={Number.isFinite(height) && height > 0 ? height : 900}
              title={attr("title")}
              sizes="(min-width: 1280px) 720px, (min-width: 768px) 85vw, 100vw"
              loading={eager ? "eager" : "lazy"}
              fetchPriority={fetchPriorityAttr || undefined}
              className={`drop-shadow-xs rounded-sm ${attr("class")}`.trim()}
              style={{ height: "auto", width: "100%" }}
              // AVIF-first picture generated from the build-time variant
              // manifest. Keep the authored file in a data attribute for the
              // lightbox's original/download action. SVG and animated GIF
              // cannot be resized/transcoded by sharp here.
              dataOriginalSrc={src}
              dataSourceSrc={IMAGE_SOURCES[src] || undefined}
              unoptimized={/\.svg$/i.test(src) || /\.gif$/i.test(src)}
            />
          );
        }
      } else {
        const chart = decodeHtmlEntities(match[3] || "");
        parts.push(<MermaidBlock key={`mermaid-${keyIndex++}`} chart={chart} />);
      }

      lastIndex = matchIndex + match[0].length;
    }

    if (lastIndex < html.length) {
      parts.push(
        <div
          key={`html-${keyIndex++}`}
          dangerouslySetInnerHTML={{ __html: html.substring(lastIndex) }}
        />
      );
    }

    if (parts.length === 0) {
      return <div dangerouslySetInnerHTML={{ __html: html }} />;
    }

    return parts;
  };

  return <>{processHTML(htmlContent)}</>;
}