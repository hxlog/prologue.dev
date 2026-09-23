import FriendLinks from "../../components/friendlinks";
import PageTransition from "../../components/page-transition";
import { getLinks } from "../../lib/vault";

export async function generateMetadata() {
  return {
    title: "友情链接 Friend Links",
    description: "但愿十年后的某天，这些链接仍存活，与各位作者共勉。",
  };
}

export default async function LinksPage() {
  const data = getLinks();

  return (
    <PageTransition>
      <FriendLinks friends={data} />
    </PageTransition>
  );
}
