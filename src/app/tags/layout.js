import { getTagCounts, getSortedTags } from "../../lib/tag-counts";
import TagPendingProvider from "../../components/tag-pending";
import TagHeader from "../../components/tag-header";
import TagSidebar from "../../components/tag-sidebar";
import { TagContent } from "../../components/tag-content-skeleton";

/**
 * Persistent shell for every tag page.
 *
 * Before this layout existed /tags/[...slug]/page.js rendered PostsLayout, so
 * switching tags replaced the header, the sidebar and the cards together and
 * the global fixed NavigationSkeleton covered the whole viewport. The shell is
 * now owned by the layout: it survives a tag → tag navigation, the header and
 * the active sidebar pill follow usePathname(), and only the page's card grid
 * is allowed to swap.
 *
 * The visual structure and classes are the ones PostsLayout renders for /blog
 * (header → grid with a 13rem sidebar column → min-w-0 content column), so the
 * two archives stay visually identical. A layout cannot receive `params`, so
 * the active tag is read from the pathname by the two client components below;
 * the counts and order come from the same lib/tag-counts functions the route
 * used before.
 */
export default function TagsLayout({ children }) {
  const tagCounts = getTagCounts();
  const sortedTags = getSortedTags();

  return (
    <TagPendingProvider>
      <TagHeader tagCounts={tagCounts} />
      <div className="mt-8 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <aside className="mb-8 lg:mb-0">
          <TagSidebar sortedTags={sortedTags} tagCounts={tagCounts} />
        </aside>
        <div className="min-w-0">
          {/* Client wrapper: paints the card skeleton above the page slot while
              a tag switch is pending, and adds nothing to the static HTML. */}
          <TagContent>{children}</TagContent>
        </div>
      </div>
    </TagPendingProvider>
  );
}
