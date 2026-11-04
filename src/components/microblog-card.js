import Image from "next/image";
import Link from "next/link";
import { formatRailDate } from "../lib/date";

/**
 * Microblog entry card, sharing the site's card language.
 *
 * Layout is the "date rail" (variant B of the card lab): a narrow mono column
 * holds the month/day and year, separated from the body by a hairline, so the
 * stream reads as a timeline rather than as a stack of post cards.
 *
 * - full:    /microblog page — all paragraphs + Weibo-style image grid
 *            (1 → wide, 2 → two squares, 3+ → three-column squares,
 *            object-cover; originals open in the global lightbox with
 *            swipe + figcaption description).
 * - compact: home sidebar — first paragraph clamped + up to 3 thumbnails.
 *
 * Images use next/image fill inside aspect-ratio boxes (CLS-safe) and carry
 * the `lightbox-image` class so the globally mounted lightbox controller picks
 * them up in DOM order (swipe across entries works for free).
 */
export default function MicroblogCard({ entry, compact = false }) {
  const { monthDay, year } = formatRailDate(entry.date);
  const gridClass =
    entry.images.length === 1
      ? "grid-cols-1"
      : entry.images.length === 2
        ? "grid-cols-2"
        : "grid-cols-3";

  const cellAspect = entry.images.length === 1 ? "aspect-[16/10]" : "aspect-square";

  const rail = (
    <div className="min-w-0 border-r border-border pt-px">
      <time dateTime={entry.date} className="flex flex-col gap-[3px]">
        <span
          className={`font-mono font-semibold leading-[1.2] tracking-[-0.02em] text-foreground tabular-nums ${compact ? "text-[15px]" : "text-base"}`}
        >
          {monthDay}
        </span>
        <span className="font-mono text-[10px] leading-[1.3] tracking-[0.06em] text-faint">
          {year}
        </span>
      </time>
    </div>
  );

  const imageGrid = (limit) => (
    <div className={`grid gap-1.5 ${gridClass}`}>
      {entry.images.slice(0, limit).map((img, i) => (
        <figure key={i} className={`relative overflow-hidden rounded-control ${cellAspect}`}>
          <Image
            src={img.src}
            alt={img.desc || "微博配图"}
            fill
            loading="lazy"
            sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw"
            className="lightbox-image object-cover transition-transform duration-(--duration-base) ease-out-expo hover:scale-[1.03]"
          />
          <figcaption className="sr-only">{img.desc || img.src}</figcaption>
        </figure>
      ))}
    </div>
  );

  if (compact) {
    return (
      <article
        id={entry.id}
        className="card card-interactive card-spotlight group scroll-offset grid grid-cols-[56px_minmax(0,1fr)] gap-x-3.5 p-4"
      >
        {rail}
        <div className="min-w-0">
          {entry.paragraphs[0] && (
            <p className="line-clamp-4 text-sm leading-6 text-muted">
              {entry.paragraphs[0]}
            </p>
          )}
          {entry.images.length > 0 && <div className="mt-3">{imageGrid(3)}</div>}
        </div>
      </article>
    );
  }

  return (
    <article
      id={entry.id}
      className="card card-interactive card-spotlight group scroll-offset grid grid-cols-[72px_minmax(0,1fr)] gap-x-[18px] p-6"
    >
      {rail}
      <div className="min-w-0">
        <div className="space-y-3">
          {entry.paragraphs.map((p, i) => (
            <p key={i} className="leading-7 text-foreground">
              {p}
            </p>
          ))}
        </div>
        {entry.images.length > 0 && (
          <div className="mt-4">{imageGrid(entry.images.length)}</div>
        )}
      </div>
    </article>
  );
}

export function MicroblogCardLink() {
  return (
    <Link href="/microblog" className="link mt-3 block text-right text-sm">
      阅读更多 →
    </Link>
  );
}
