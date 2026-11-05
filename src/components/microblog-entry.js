import Image from "next/image";
import { formatRailDate } from "../lib/date";

/**
 * One microblog entry in the shared timeline.
 *
 * The timeline is structural, not a stack of cards: the date rail, the spine
 * and the node are owned by MicroblogTimeline; this component only renders the
 * date cell and the body. That is what lets /microblog and the home sidebar
 * share exactly one layout while the home version is compact.
 *
 * The rail is deliberately wide enough for "10.02" at every breakpoint, with
 * `white-space: nowrap` on both lines -- the date is a label, not an ellipsis
 * candidate.
 *
 * Images keep the existing Weibo-style grid (1 wide / 2 squares / 3+ squares),
 * fill their aspect-ratio boxes so CLS stays zero, and keep the
 * `lightbox-image` class so the globally mounted lightbox pages through them in
 * DOM order. In the no-card timeline they use the full body column, so the
 * images are wider than they were inside the old card padding.
 */
export default function MicroblogEntry({ entry, compact = false }) {
  const { monthDay, year } = formatRailDate(entry.date);
  const images = entry.images || [];
  const gridClass =
    images.length === 1
      ? "grid-cols-1"
      : images.length === 2
        ? "grid-cols-2"
        : "grid-cols-3";
  const cellAspect = images.length === 1 ? "aspect-[16/10]" : "aspect-square";

  const imageGrid = (limit) => (
    <div className={`microblog-images grid gap-1.5 ${gridClass}`}>
      {images.slice(0, limit).map((img, i) => (
        <figure
          key={i}
          className={`relative min-w-0 overflow-hidden rounded-control ${cellAspect}`}
        >
          <Image
            src={img.src}
            alt={img.desc || "微博配图"}
            fill
            loading="lazy"
            sizes={
              compact
                ? "(min-width: 1024px) 18rem, 82vw"
                : "(min-width: 1024px) 42rem, (min-width: 640px) 70vw, 78vw"
            }
            className="lightbox-image object-cover transition-transform duration-(--duration-base) ease-out-expo hover:scale-[1.03]"
          />
          <figcaption className="sr-only">{img.desc || img.src}</figcaption>
        </figure>
      ))}
    </div>
  );

  return (
    <li
      id={entry.id}
      className={`microblog-entry scroll-offset${compact ? " microblog-entry--compact" : ""}`}
    >
      <div className="microblog-date">
        <time dateTime={entry.date}>
          <span className="microblog-day">{monthDay}</span>
          <span className="microblog-year">{year}</span>
        </time>
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
            {entry.paragraphs.map((p, i) => (
              <p key={i} className="microblog-text">
                {p}
              </p>
            ))}
          </div>
        )}
        {images.length > 0 && imageGrid(compact ? 3 : images.length)}
      </div>
    </li>
  );
}
