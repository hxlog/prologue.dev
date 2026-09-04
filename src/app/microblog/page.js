import PageTransition from "../../components/page-transition";
import MicroblogCard from "../../components/microblog-card";
import { getMicroblog } from "../../lib/microblog";

export async function generateMetadata() {
  return {
    title: "微博 Microblog",
    description: "槐序的微博：碎片化的思考、图文与随想。",
  };
}

export default async function MicroblogPage() {
  const entries = getMicroblog();

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
