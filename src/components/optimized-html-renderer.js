import Image from "next/image";
import { MermaidBlock } from "./mermaid-block";
import { decodeHtmlEntities } from "../lib/html-entities";

/**
 * Split post HTML into React nodes: Next/Image for <img>, MermaidBlock for
 * <pre class="mermaid">, and dangerouslySetInnerHTML for everything else.
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
        const srcMatch = attributes.match(/\bsrc=["']([^"']*?)["']/i);
        const altMatch = attributes.match(/\balt=["']([^"']*?)["']/i);
        const titleMatch = attributes.match(/\btitle=["']([^"']*?)["']/i);
        const classMatch = attributes.match(/\bclass=["']([^"']*?)["']/i);

        if (srcMatch) {
          parts.push(
            <Image
              key={`img-${keyIndex++}`}
              src={srcMatch[1]}
              alt={altMatch ? altMatch[1] : ""}
              width={1920}
              height={1080}
              title={titleMatch ? titleMatch[1] : ""}
              sizes="(min-width: 1280px) 896px, 100vw"
              className={`drop-shadow-xs rounded-sm ${classMatch ? classMatch[1] : ""}`.trim()}
              style={{ height: "auto", width: "100%" }}
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
