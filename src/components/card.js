import Link from "next/link";
import TagChips from "./tag-chips";
import { formatDate } from "../lib/date";

/**
 * The one post card used everywhere: home, archive, tag pages and related
 * posts. Server component — date formatting happens at build time and no
 * client JS ships for the card itself.
 *
 * Anatomy:
 *   meta row (date · reading time)
 *   title            → stretched link covers the whole card
 *   muted excerpt    → line-clamped
 *   tag chips        → real links, sit above the stretched link (z-10)
 *
 * Prefetch uses Next's default strategy. Do NOT set prefetch={true} on a card:
 * in the static export, a completed full prefetch can leave a route-cache
 * entry that the client router then fails to navigate from (click is
 * preventDefault-ed and nothing happens), reproducing the dead-card bug.
 */
export default function Card({
  slug,
  title,
  description,
  publishDate,
  tags,
  readingTime,
}) {
  return (
    <article className="card card-interactive card-spotlight group relative flex flex-col p-5">
      <div className="flex items-center gap-2 text-xs text-faint">
        <time dateTime={publishDate}>{formatDate(publishDate)}</time>
        {readingTime ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{readingTime}</span>
          </>
        ) : null}
      </div>

      <h3 className="card-title mt-2.5 text-lg font-semibold leading-7 tracking-tight text-foreground transition-colors duration-(--duration-fast)">
        <Link
          href={slug}
          className="after:absolute after:inset-0 after:content-['']"
        >
          {title}
        </Link>
      </h3>

      {description ? (
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted">
          {description}
        </p>
      ) : null}

      {tags?.length ? (
        <div className="relative z-10 mt-auto pt-4">
          <TagChips tags={tags} />
        </div>
      ) : null}
    </article>
  );
}