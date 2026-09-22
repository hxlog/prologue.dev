import { allPosts } from "./content";

export const tagCounts = (() => {
  const counts = {};
  for (const post of allPosts) {
    if (post.draft) continue;
    const tags = post.tags || [];
    for (const tag of tags) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  return counts;
})();

export const sortedTags = Object.keys(tagCounts).sort(
  (a, b) => tagCounts[b] - tagCounts[a]
);
