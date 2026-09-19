import { requireUser } from "../../../../lib/auth/require";
import { listTagsForStudio } from "../../../../lib/studio/tags-write";
import TagsEditor from "./tags-editor";

/**
 * The taxonomy.
 *
 * The 15 tags arrived from the static site with their Chinese labels in
 * `data/tagLabels.js`; the labels have lived in `tags.label` since the import
 * and that file is now only a fallback. This is where they are edited.
 *
 * Read uncached, for the same reason the session list is: there are fifteen
 * rows, the screen is opened by one person, and a stale counts next to a tag
 * you are about to delete is worse than a query. The actions call
 * `revalidatePath` on this route after a write, so the list refreshes itself.
 */
export const metadata = { title: "标签" };
export const instant = false;

export default async function TagsPage() {
  await requireUser();
  const tags = await listTagsForStudio();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">标签</h1>
        <p className="mt-1 text-xs text-faint">
          {tags.length} 个标签 · 顺序即 /blog 侧边栏顺序
        </p>
      </header>

      <TagsEditor initial={tags} />
    </div>
  );
}
