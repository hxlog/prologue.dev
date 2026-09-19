import PageTransition from "../../../components/page-transition.js";
import MicroblogCard from "../../../components/microblog-card.js";
import { getMicroblog } from "../../../lib/content/collections.js";

export async function generateMetadata() {
  return {
    title: "微博 Microblog",
    description: "槐序的微博：碎片化的思考、图文与随想。",
  };
}

export default async function MicroblogPage() {
  // Reads the `microblog` collection. The entries arrive in the same normalized
  // shape (paragraphs[] + images[]) the cards already render, and keep their
  // original anchors, so the page is unchanged by the move off YAML.
  const entries = await getMicroblog();

  return (
    <PageTransition className="mx-auto max-w-2xl py-8">
      <p className="eyebrow">Microblog</p>
      <h1 className="mt-2 pb-8 text-3xl font-semibold tracking-tight text-foreground">
        微博
      </h1>
      <div className="space-y-4">
        {entries.map((entry) => (
          <MicroblogCard key={entry.id} entry={entry} />
        ))}
      </div>
    </PageTransition>
  );
}
