import fs from "fs";
import path from "path";
import { parse } from "yaml";
import FriendLinks from "../../components/friendlinks";
import PageTransition from "../../components/page-transition";
import RouteTransition from "../../components/route-transition";
import { getRotationOffset } from "../../lib/rotation";

export async function generateMetadata() {
  return {
    title: "友情链接 Friend Links",
    description: "但愿十年后的某天，这些链接仍存活，与各位作者共勉。",
  };
}

/* Cache Components gates (Next 16.4).
   - instant = true: assert that a navigation into this route paints UI
     immediately. Validation runs in development and names the component that
     would block it; the build is unaffected.
   - ensureStatic = "shell": the App Shell for this route must stay prerendered
     at build time. It is a ratchet against a later change quietly turning the
     route request-rendered — the failure mode is a build error, not a slow
     page nobody measures. */
export const instant = true;
export const ensureStatic = "shell";

export default async function LinksPage() {
  const filePath = path.join(process.cwd(), "data", "links.yaml");
  const links = fs.readFileSync(filePath, "utf8");
  const data = parse(links);

  /* Rotate the grid server-side rather than shuffling it after mount: see
     lib/rotation.js. A post-hydration shuffle is a layout shift by
     construction. */
  const offset = await getRotationOffset(data.length);
  const friends = offset ? [...data.slice(offset), ...data.slice(0, offset)] : data;

  return (
    <RouteTransition>
      <PageTransition>
        <FriendLinks friends={friends} />
      </PageTransition>
    </RouteTransition>
  );
}
