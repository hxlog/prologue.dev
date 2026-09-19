/**
 * Line diff, for the revision history.
 *
 * Myers' greedy algorithm — the one `git diff` is built on — not an LCS table.
 * The distinction matters at this size. A revision diff is usually a handful of
 * changed lines inside two nearly identical documents, and Myers is
 * O((N+M)·D) where D is the edit distance, so it is effectively linear on the
 * common case. An O(N·M) table would be ~200k cells for the longest post here
 * (452 lines) and would pay that cost even when nothing changed.
 *
 * Written rather than installed because the output shape this needs is narrow —
 * aligned rows for a unified view — and the diff packages on npm return a patch
 * format that would then have to be re-parsed into it.
 *
 * Two details worth knowing before editing this file, because both were got
 * wrong on the first attempt and both were caught by check-diff.mjs:
 *
 *   `trace[d]` holds the furthest-reaching frontier from step d-1, snapshotted
 *   BEFORE step d runs. Storing the post-step frontier instead still produces
 *   the correct edit distance, so it looks like it works — and then the
 *   backtrack walks off the end of the document and reports every line as
 *   removed. Reconstruction is the assertion that catches it.
 *
 *   A "moved" line is one that appears in BOTH the removals and the additions
 *   of the same diff. That is a heuristic, and it is honest about being one:
 *   Myers reports a relocation as an unrelated delete plus insert, and a
 *   reviewer seeing two identical lines marked "changed" in different places
 *   concludes the diff is broken. Blank lines are excluded — reindenting or
 *   adding a paragraph break is not a relocation.
 */

/**
 * @param {string} before
 * @param {string} after
 * @returns {{rows: Array, stats: {added:number, removed:number, moved:number},
 *            truncated: boolean, identical: boolean}}
 */
export function diffDocuments(before, after, { context = 3, maxLines = 4000 } = {}) {
  const a = splitLines(before);
  const b = splitLines(after);

  if (a.length > maxLines || b.length > maxLines) {
    return {
      rows: [
        {
          type: "meta",
          text: `文件过大，无法逐行比较（${a.length} → ${b.length} 行）`,
          beforeLine: null,
          afterLine: null,
          moved: false,
        },
      ],
      stats: { added: 0, removed: 0, moved: 0 },
      truncated: true,
      identical: false,
    };
  }

  const ops = myers(a, b);
  const movedFlags = markMoved(ops, a, b);

  let added = 0;
  let removed = 0;
  let moved = 0;
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type === "add") {
      added++;
      if (movedFlags[i]) moved++;
    } else if (ops[i].type === "remove") {
      removed++;
      if (movedFlags[i]) moved++;
    }
  }

  const rows = applyContext(ops, movedFlags, a, b, context);
  return { rows, stats: { added, removed, moved }, truncated: false, identical: added === 0 && removed === 0 };
}

/**
 * Split on any line terminator, dropping a single trailing empty element.
 *
 * The trailing newline is the classic source of a phantom "last line changed":
 * `"a\nb\n"` and `"a\nb"` hold the same two lines and differ only in whether
 * the file ends with a newline. Reporting that as a changed line would be a
 * lie, and it would fire on every save of a file that does not end with one.
 */
function splitLines(text) {
  const s = String(text ?? "");
  if (s === "") return [];
  const lines = s.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Myers' greedy LCS. Returns ops in document order, tagged
 * 'equal' | 'remove' | 'add' with the index each refers to.
 */
function myers(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  const size = 2 * max + 1;

  // `v[k]` is the furthest x reached on diagonal k = x - y, stored at k+offset
  // because k ranges over negatives. A typed array starts at zero, which is
  // exactly the initial state (V[1] = 0: the empty prefix is reachable on
  // diagonal 1 at x = 0).
  let v = new Int32Array(size);
  const trace = [];
  let found = -1;

  for (let d = 0; d <= max; d++) {
    // Snapshot BEFORE step d — see the header. The backtrack indexes `trace[d]`
    // expecting the frontier that led INTO step d.
    trace.push(Int32Array.from(v));

    for (let k = -d; k <= d; k += 2) {
      const kIdx = k + offset;

      // Move down (insert from b) when there is no left neighbour, or when the
      // right neighbour is further along. Preferring down on ties decides which
      // of several equally-short scripts is reported, and it is the choice that
      // puts an addition after its surrounding removals, as a reader expects.
      let x;
      if (k === -d || (k !== d && v[kIdx - 1] < v[kIdx + 1])) {
        x = v[kIdx + 1];
      } else {
        x = v[kIdx - 1] + 1;
      }

      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[kIdx] = x;

      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }

  // Walk the recorded frontier backwards. Every step consumes one non-diagonal
  // edit and then the diagonal run that precedes it.
  const ops = [];
  let x = n;
  let y = m;

  for (let d = found; d >= 0; d--) {
    const vv = trace[d];
    const k = x - y;
    const kIdx = k + offset;

    let prevK;
    if (k === -d || (k !== d && vv[kIdx - 1] < vv[kIdx + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = vv[prevK + offset];
    const prevY = prevX - prevK;

    // The diagonal run: lines identical on both sides.
    while (x > prevX && y > prevY) {
      ops.push({ type: "equal", aIndex: x - 1, bIndex: y - 1 });
      x--;
      y--;
    }

    if (d > 0) {
      if (x === prevX) {
        // Moved down: b contributed a line that a has no match for.
        ops.push({ type: "add", bIndex: y - 1 });
        y--;
      } else {
        ops.push({ type: "remove", aIndex: x - 1 });
        x--;
      }
    }
  }

  ops.reverse();
  return ops;
}

/**
 * Flag ops whose line text also appears on the other side of the diff.
 *
 * Determined per line text with a shared budget: if `foo` was removed twice and
 * added twice, at most two removals and two additions are marked. A text that
 * was only removed, or only added, is not a move at all — it is an edit.
 */
function markMoved(ops, a, b) {
  const removed = new Map();
  const added = new Map();

  for (const op of ops) {
    if (op.type === "remove") {
      const t = a[op.aIndex];
      removed.set(t, (removed.get(t) || 0) + 1);
    } else if (op.type === "add") {
      const t = b[op.bIndex];
      added.set(t, (added.get(t) || 0) + 1);
    }
  }

  const budget = new Map();
  for (const [text, count] of removed) {
    const other = added.get(text);
    if (!other) continue;
    // Blank lines are never moves: reindenting a block or inserting a paragraph
    // break is not a relocation, and marking it as one makes every reformat
    // look like a structural change.
    if (text.trim() === "") continue;
    budget.set(text, Math.min(count, other));
  }

  const flags = new Array(ops.length).fill(false);
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === "equal") continue;
    const text = op.type === "add" ? b[op.bIndex] : a[op.aIndex];
    const left = budget.get(text) || 0;
    if (left <= 0) continue;
    budget.set(text, left - 1);
    flags[i] = true;
  }
  return flags;
}

/**
 * Collapse long runs of unchanged lines into a gap marker.
 *
 * `context` lines survive on each side of an edit — the same default as
 * `git diff -U3`: enough to see the heading or list item a change sits under,
 * few enough that a one-word edit in a 450-line post is a short page.
 */
function applyContext(ops, movedFlags, a, b, context) {
  if (!ops.some((op) => op.type !== "equal")) return [];

  const keep = new Array(ops.length).fill(false);
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type === "equal") continue;
    const from = Math.max(0, i - context);
    const to = Math.min(ops.length - 1, i + context);
    for (let j = from; j <= to; j++) keep[j] = true;
  }

  const rows = [];
  let skipping = 0;

  const pushGap = () => {
    if (!skipping) return;
    rows.push({
      type: "gap",
      text: `⋯ 未改动的 ${skipping} 行`,
      beforeLine: null,
      afterLine: null,
      moved: false,
      hidden: skipping,
    });
    skipping = 0;
  };

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!keep[i]) {
      skipping++;
      continue;
    }
    pushGap();

    rows.push({
      type: op.type === "equal" ? "context" : op.type,
      text: op.type === "add" ? b[op.bIndex] : a[op.aIndex],
      beforeLine: op.type === "add" ? null : op.aIndex + 1,
      afterLine: op.type === "remove" ? null : op.bIndex + 1,
      moved: movedFlags[i] === true,
    });
  }
  pushGap();

  return rows;
}
