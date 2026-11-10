import Image from "next/image";
import { formatRailDate } from "../lib/date";

/**
 * One microblog card inside a year section.
 *
 * The card is a plain <article>, not a button: text and empty card space are
 * deliberately inert even though the surface now carries the article-card
 * hover decoration (lift, tri-hue rim, pointer glow). The only clickable
 * target is an image, which keeps the `lightbox-image` class so the global
 * article lightbox pages through the images inside this card. The lightbox
 * caption comes from the image alt / figcaption, so `desc` is what a reader
 * sees under the enlarged image.
 *
 * The year lives in MicroblogTimeline, outside the card; this component only
 * renders the month/day label. Images keep the 1 / 2 / 3 Weibo grid, with a
 * surface border and hairline shadow so they read as inset plates rather than
 * edge-to-edge tiles.
 */
export default function MicroblogEntry({ entry, compact = false }) {
  const { monthDay } = formatRailDate(entry.date);
  const allImages = entry.images || [];
  const images = compact ? allImages.slice(0, 3) : allImages;
  const cols = Math.min(images.length, 3);

  return (
    <li id={entry.id} className="microblog-entry scroll-offset">
      <article className="microblog-card card card-interactive card-spotlight">
        <div className="microblog-top">
          <time className="microblog-date" dateTime={entry.date}>
            {monthDay}
          </time>
          <span className="microblog-rule" aria-hidden="true" />
        </div>
        <div className="microblog-body">
          {compact ? (
            entry.paragraphs[0] && (
              <p className="microblog-text microblog-text--compact">
                {entry.paragraphs[0]}
              </p>
            )
          ) : (
            <div className="microblog-paragraphs">
              {entry.paragraphs.map((paragraph, index) => (
                <p key={index} className="microblog-text">
                  {paragraph}
                </p>
              ))}
            </div>
          )}
          {images.length > 0 && (
            <div className={`microblog-media microblog-media--${cols}`}>
              {images.map((image, index) => (
                <figure className="microblog-media-item" key={index}>
                  <Image
                    src={image.src}
                    alt={image.desc || "微博配图"}
                    fill
                    loading="lazy"
                    sizes={
                      compact
                        ? "(min-width: 1024px) 18rem, 82vw"
                        : "(min-width: 1024px) 42rem, (min-width: 640px) 70vw, 78vw"
                    }
                    className="lightbox-image object-cover"
                    // Same reason as the article renderer: the optimizer rejects
                    // SVG and would flatten an animated bitmap to one frame.
                    unoptimized={/\.svg$/i.test(image.src) || /\.gif$/i.test(image.src)}
                  />
                  <figcaption className="sr-only">
                    {image.desc || image.src}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      </article>
    </li>
  );
}
