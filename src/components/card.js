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
 * `prefetch` is on: a card is an explicit "read this next" signal, and every
 * post is static, so the per-link prefetch resolves params from the static
 * cache instead of the runtime.
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

      <h3 className="card-title mt-2.5 text-lg font-semibold leading-7 tracking-tight text-foreground transition-colors duration-fast">
        <Link
          href={slug}
          prefetch={true}
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
