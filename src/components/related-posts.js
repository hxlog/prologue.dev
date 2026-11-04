import Card from "./card";
import { getRelatedPosts } from "../lib/related";
import { readingTimeLabel } from "../lib/date";

/**
 * "相关推荐" — 4 related posts as cards (danarnoux-style 2×2 grid),
 * algorithmically chosen via tag overlap + recency (see src/lib/related.js),
 * excluding the previous/next posts which have their own nav block.
 * Server component: computed at build time from getPosts().
 */
export default function RelatedPosts({ post, allPosts, excludeSlugs = [] }) {
  const related = getRelatedPosts(post, allPosts, {
    exclude: excludeSlugs.filter(Boolean),
    count: 4,
  });

  if (!related.length) return null;

  return (
    <section className="mt-12 border-t border-border pt-10">
      <p className="eyebrow">Read More</p>
      <h2 className="mt-2 text-h2 font-semibold tracking-tight text-foreground">
        相关推荐
      </h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {related.map((relatedPost) => (
          <Card
            key={relatedPost.slug}
            slug={relatedPost.slug}
            title={relatedPost.title}
            description={relatedPost.description}
            publishDate={relatedPost.publishDate}
            tags={relatedPost.tags}
            readingTime={readingTimeLabel(relatedPost.readingTime)}
          />
        ))}
      </div>
    </section>
  );
}
