import { getPosts } from "./content";

/**
 * Tag counts and the descending tag order, derived from the posts.
 *
 * FUNCTIONS, not the module constants these used to be. `allPosts` was a
 * module-level array, so a constant computed from it froze at first evaluation
 * and survived every content edit -- the same staleness the loader's snapshot
 * fixes. The work is a walk over 63 documents in memory (no fs, no parsing),
 * so recomputing on each render costs nothing worth caching, and caching it
 * would reintroduce exactly the bug.
 */
export function getTagCounts() {
  const counts = {};
  for (const post of getPosts()) {
    if (post.draft) continue;
    for (const tag of post.tags || []) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  return counts;
}

export function getSortedTags() {
  const counts = getTagCounts();
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
}
