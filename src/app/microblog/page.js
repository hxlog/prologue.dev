import PageTransition from "../../components/page-transition";
import RouteTransition from "../../components/route-transition";
import MicroblogCard from "../../components/microblog-card";
import { getMicroblog } from "../../lib/microblog";

export async function generateMetadata() {
  return {
    title: "微博 Microblog",
    description: "槐序的微博：碎片化的思考、图文与随想。",
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

export default async function MicroblogPage() {
  const entries = getMicroblog();

  return (
    <RouteTransition>
      <PageTransition className="mx-auto max-w-2xl py-8">
        <header>
          <p className="eyebrow">Microblog</p>
          <h1 className="mt-2 text-h1 font-semibold tracking-tight text-foreground">
            微博
          </h1>
          <p className="mt-2 pb-8 text-sm text-muted">
            碎片化的思考、图文与随想。
          </p>
        </header>
        <div className="space-y-4">
          {entries.map((entry) => (
            <MicroblogCard key={entry.id} entry={entry} />
          ))}
        </div>
      </PageTransition>
    </RouteTransition>
  );
}
