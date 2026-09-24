import fs from "fs";
import path from "path";
import { parse } from "yaml";
import FriendLinks from "../../components/friendlinks";
import PageTransition from "../../components/page-transition";
import RouteTransition from "../../components/route-transition";

export async function generateMetadata() {
  return {
    title: "友情链接 Friend Links",
    description: "但愿十年后的某天，这些链接仍存活，与各位作者共勉。",
  };
}

export default async function LinksPage() {
  const filePath = path.join(process.cwd(), "data", "links.yaml");
  const links = fs.readFileSync(filePath, "utf8");
  const data = parse(links);

  return (
    <RouteTransition>
      <PageTransition>
        <FriendLinks friends={data} />
      </PageTransition>
    </RouteTransition>
  );
}
