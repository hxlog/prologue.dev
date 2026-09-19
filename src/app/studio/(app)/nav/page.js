import { requireUser } from "../../../../lib/auth/require";
import { listNavItems } from "../../../../lib/studio/nav";
import NavEditor from "./nav-editor";

/**
 * The navigation editor.
 *
 * The header's links used to be `data/headerNavLinks.js` — a file edited in an
 * editor and deployed. They are now rows, because reordering them was the
 * common case and a deploy for it was absurd. See
 * db/migrations/0010_nav_becomes_data.sql for the one-time reconciliation, and
 * src/lib/studio/nav.js for why the page-backed entries here cannot simply be
 * deleted.
 *
 * The list is read uncached. It is a list on an admin screen opened by one
 * person: caching it would add an invalidation to reason about and save a query
 * nobody would notice.
 */
export const metadata = { title: "导航" };
export const instant = false;

export default async function NavPage() {
  await requireUser();
  const items = await listNavItems();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">导航</h1>
        <p className="mt-1 text-xs text-faint">
          {items.length} 个链接 · 顺序即页头显示顺序
        </p>
      </header>

      <NavEditor initial={items} />
    </div>
  );
}
