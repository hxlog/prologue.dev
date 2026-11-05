import { formatRailDate } from "../lib/date";
import MicroblogEntry from "./microblog-entry";

/**
 * The one microblog feed used by /microblog and the home sidebar.
 *
 * Entries are grouped by year and each year gets its own spine: the year label
 * sits before the cards, never inside one, and the line resets for the next
 * year. The cards are static surfaces; the only interactive target is an image,
 * which the globally mounted lightbox opens. `compact` changes the rail width,
 * card padding, type and paragraph clamp only.
 */
export default function MicroblogTimeline({ entries, compact = false }) {
  if (!entries?.length) {
    return (
      <p className="py-6 text-sm text-muted">还没有微博，过几天再来看看。</p>
    );
  }

  const groups = [];
  const byYear = new Map();
  for (const entry of entries) {
    const year = formatRailDate(entry.date).year;
    if (!byYear.has(year)) {
      const group = { year, entries: [] };
      byYear.set(year, group);
      groups.push(group);
    }
    byYear.get(year).entries.push(entry);
  }

  return (
    <div className={`microblog-feed${compact ? " microblog-feed--compact" : ""}`}>
      {groups.map((group) => (
        <section
          key={group.year}
          className="microblog-year"
          aria-label={`${group.year} 年`}
        >
          <span className="microblog-year-label" aria-hidden="true">
            {group.year}
          </span>
          <ol className="microblog-entries">
            {group.entries.map((entry) => (
              <MicroblogEntry
                key={entry.id}
                entry={entry}
                compact={compact}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
