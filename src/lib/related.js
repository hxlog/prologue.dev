/**
 * Related-posts selection — deterministic, build-time, zero client JS.
 *
 * Score per candidate (relative to the current post):
 *   1. tag overlap × 10      (dominant signal — needs the full taxonomy)
 *   2. recency 0..5          (3-year linear decay, gentle tie-breaker)
 *   3. featured +1           (editorial boost)
 * Fallback chain when fewer than `count` candidates score above 0:
 *   posts sharing the current post's first tag → then the most recent posts
 *   (featured first). Prev/next posts are always excluded.
 */

const DAY = 24 * 60 * 60 * 1000;
const RECENCY_WINDOW_DAYS = 365 * 3;

function ageScore(candidateDate, referenceDate) {
  const ageDays = (referenceDate - candidateDate) / DAY;
  if (ageDays >= RECENCY_WINDOW_DAYS) return 0;
  return (1 - ageDays / RECENCY_WINDOW_DAYS) * 5;
}

export function getRelatedPosts(post, allPosts, { exclude = [], count = 4 } = {}) {
  const excluded = new Set([post.slugAsParams, ...exclude]);
  const postTags = post.tags || [];
  const referenceDate = new Date(post.publishDate).getTime();

  const scored = allPosts
    .filter((p) => p.draft !== true && !excluded.has(p.slugAsParams))
    .map((candidate) => {
      const candidateTags = candidate.tags || [];
      const overlap = candidateTags.filter((t) => postTags.includes(t)).length;
      const score =
        overlap * 10 +
        ageScore(new Date(candidate.publishDate).getTime(), referenceDate) +
        (candidate.featured ? 1 : 0);
      return { candidate, overlap, score };
    });

  scored.sort((a, b) => b.score - a.score);

  const picked = scored.filter((s) => s.overlap > 0).slice(0, count);

  if (picked.length < count) {
    // Fallback 1: same primary tag even without overlap score ordering.
    const primary = postTags[0];
    if (primary) {
      for (const s of scored) {
        if (picked.length >= count) break;
        if (s.overlap === 0 && s.candidate.tags?.includes(primary)) picked.push(s);
      }
    }
    // Fallback 2: most recent posts, featured first.
    for (const s of scored) {
      if (picked.length >= count) break;
      if (!picked.includes(s)) picked.push(s);
    }
  }

  return picked.slice(0, count).map((s) => s.candidate);
}
