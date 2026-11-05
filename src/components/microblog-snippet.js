import Link from "next/link";
import MicroblogTimeline from "./microblog-timeline";
import { getMicroblog } from "../lib/microblog";

/**
 * Home-sidebar microblog block: the three latest entries as compact cards
 * (matching the site card language), with thumbnails when images exist.
 */
export default function MicroblogSnippet() {
  const entries = getMicroblog().slice(0, 3);

  return (
    <section className="mt-10">
      <h2 className="section-label">微博</h2>
      <div className="mt-3">
        <MicroblogTimeline entries={entries} compact />
      </div>
      <Link
        href="/microblog"
        className="link mt-3 block text-right text-sm"
      >
        阅读更多 →
      </Link>
    </section>
  );
}
