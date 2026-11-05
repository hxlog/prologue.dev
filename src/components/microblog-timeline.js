import MicroblogEntry from "./microblog-entry";

/**
 * The one microblog timeline used by /microblog and the home sidebar.
 * `compact` changes the rail width, body type and paragraph clamp only; the
 * order, anchors, date rail and image grid stay identical.
 */
export default function MicroblogTimeline({ entries, compact = false }) {
  if (!entries?.length) {
    return (
      <p className="py-6 text-sm text-muted">还没有微博，过几天再来看看。</p>
    );
  }

  return (
    <ol
      className={`microblog-timeline${compact ? " microblog-timeline--compact" : ""}`}
    >
      {entries.map((entry) => (
        <MicroblogEntry key={entry.id} entry={entry} compact={compact} />
      ))}
    </ol>
  );
}
