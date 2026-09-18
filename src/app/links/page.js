import FriendLinks from "../../components/friendlinks";
import PageTransition from "../../components/page-transition";
import { getLinks } from "../../lib/content/collections";

export async function generateMetadata() {
  return {
    title: "友情链接 Friend Links",
    description: "但愿十年后的某天，这些链接仍存活，与各位作者共勉。",
  };
}

export default async function LinksPage() {
  // Reads the `links` collection. Field names are mapped back to the shape the
  // component already renders (`name` / `description` / `blog_url` / `avatar`),
  // so the page markup is unchanged.
  const links = await getLinks();

  return (
    <PageTransition>
      <FriendLinks friends={links} />
    </PageTransition>
  );
}
