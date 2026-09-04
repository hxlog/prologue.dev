import Link from "next/link";
import MicroblogCard from "./microblog-card";
import { getMicroblog } from "../lib/microblog";

/**
 * Home-sidebar microblog block: the three latest entries as compact cards
 * (matching the site card language), with thumbnails when images exist.
 */
export default function MicroblogSnippet() {
  const entries = getMicroblog().slice(0, 3);

  return (
    <div className="mx-auto mt-8 max-w-2xl">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
        <span
          className="inline-block h-3 w-1 rounded-full"
          style={{ background: "var(--gradient-brand)" }}
          aria-hidden="true"
        />
        微博
      </h2>
      <div className="mt-3 space-y-3">
        {entries.map((entry) => (
          <MicroblogCard key={entry.id} entry={entry} compact />
        ))}
      </div>
      <Link href="/microblog" passHref>
        <p className="pt-2 text-right text-sm text-muted transition-colors duration-300 hover:text-accent hover:underline">
          阅读更多 →
        </p>
      </Link>
    </div>
  );
}
