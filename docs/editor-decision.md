# Editor choice: CodeMirror 6

Decided 2026-09-19. The requirement was unusual and it eliminated almost
everything: edit **markdown source directly**, with a preview that matches the
published static site exactly, and pick a project with long-term staying power.

The constraint that decided it is narrower than it first looks. The user offered
to rewrite all 63 posts into whatever format the editor wanted, so format
friction was *forgivable*. What was not forgivable was a preview that renders
**differently from the published page** — because the whole storage design
(CLAUDE.md: "the editor previews exactly what will be published... true by
construction") rests on both calling `src/lib/markdown/render.js`.

## Results, measured on the real corpus

Every candidate was driven against all 63 posts plus `about.md`, loading the
source, and reading it back out.

| Editor | Round-trip on 64 files | Verdict |
|---|---|---|
| **CodeMirror 6** | **64/64 byte-identical** | **chosen** |
| ByteMD | 64/64 byte-identical | abandoned upstream — see below |
| MDX Editor | 7/64 clean; 41 changed, 12 threw | rejected |
| Milkdown (best config: full Crepe) | 0/64; 1,209 lines rewritten | rejected |
| Tiptap | 0/63 byte-identical; 39 content-changed | rejected |

### Why the three rejected ones failed

**Milkdown** is the most instructive failure, and the numbers above are its
*best* configuration — full Crepe 7.22.1 with code-mirror, latex, list-item and
table features. Plain commonmark+gfm is worse (1,693 lines). Its *smallest*
diff in the entire corpus was:

```
- ---
+ ***
- tags: ["Sociology", "Philosophy"]
+ tags: \["Sociology", "Philosophy"\]
- ---
+ ----------------------------------------------
```

That is not a rounding error, it is a document model: Milkdown parses markdown
into ProseMirror nodes and re-serializes. ProseMirror has no representation for
frontmatter at all, nor for `---` vs `***` (both are just `thematicBreak`), for
`-` vs `*` bullets, for `_` vs `*` emphasis, or for a 2-space hard break — so
each is re-invented from `mdast-util-to-markdown`'s defaults at serialization
time. Every file changes on open, and autosave commits the change.

There is no `@milkdown/plugin-frontmatter` on npm, and bolting on
`remark-frontmatter` throws (`Cannot match target parser for node: yaml`) — so
frontmatter does not merely get reformatted, it is merged into the body as a
setext heading. `content_hash` over the stored markdown would change on every
open, which is precisely the signal autosave uses to decide nothing changed.

Milkdown has one real advantage: the damage is **idempotent** — a second
round-trip is 64/64 stable — so only the first save rewrites a file. That first
save is the one that would produce a revision diff the author never made.

Milkdown is a fine editor. It is a *WYSIWYG* editor, and WYSIWYG was explicitly
rejected — the request was to edit markdown source directly.

**MDX Editor** (4.2.5, actively released) round-tripped 7 of 64 cleanly and
**threw outright on 12** — it could not open them at all. Its strongest
configuration (tuned bullet/emphasis/strong/rule options) moved the needle from
0 byte-identical to 1. Same document-model problem.

**Tiptap** — the original proposal — was the worst: 0 of 63 byte-identical,
39 with changed *content*. The earlier finding that `@tiptap/markdown` drops
unregistered nodes and breaks `$$`, GFM tables and footnotes stands.

### Why ByteMD was rejected despite a perfect round-trip

ByteMD scored identically to CodeMirror on the thing that mattered, using
CodeMirror 5 underneath in YAML-frontmatter mode — raw string, no document
model, zero spurious change events on mount. It was the runner-up on merit.

It fails on the user's explicit second requirement, "不可和 contentlayer2 一样烂尾":

- 19 months since the last npm publish (`1.22.0`, 2025-02-12), and the 23-month
  gap before that.
- 51 open issues and PRs; **9 issues opened since 2025-01-01, none answered**.
  Open PRs from 2023 and 2026, neither merged. Last maintainer reply: 2025-02-12.
- The README's designated successor, **HashMD, is deader than the thing it
  replaces**: v0.0.1 unchanged since Oct 2023, ~5 downloads/week, self-described
  "WIP". The escape hatch is not an escape hatch.

And a second, independent disqualifier: ByteMD bundles `mdast-util-from-markdown@1`,
so its preview pipeline is frozen at unified@10. Compiling **our** corpus with
**our** plugins through ByteMD's processor: **22 of 64 files threw**
(`remark-gfm@4` → `Cannot set properties of undefined (setting 'inTable')`;
`remark-math@6` → `reading 'mathFlowInside'`). Making it work would mean pinning
`remark-gfm` and `remark-math` two majors behind the publishing pipeline — i.e.
deliberately breaking the preview-equals-publish invariant — and ByteMD's
preview is a different renderer anyway (no shiki, no `rehype-mermaid-pre`, no
gemoji, `rehype-sanitize` with `defaultSchema` always on, which rewrites `id` →
`user-content-*` and would break every heading anchor).

## Why CodeMirror 6

1. **It has no document model.** The buffer is a `Text` rope of the exact string
   it was given. Load → `toString()` is byte-identical on 64/64, including
   frontmatter, `$$` blocks, GFM tables, mermaid fences, CRLF-derived content,
   and a 20 KB single line. This is the property everything else depends on.

2. **The preview is trivially our own renderer.** Because the editor holds a
   string, "preview" is `renderMarkdown(source)` — literally the function
   publishing calls. There is no second pipeline to keep in sync, which is
   exactly what ByteMD could not offer and the rejected WYSIWYG editors offer
   even less.

3. **Maintenance is the best of the set, by a wide margin.** All five core
   packages were published within the last 4 months (`@codemirror/view` has had
   **47 releases in 12 months**); the newest is 4 days old. Eleven years of
   history, a single author (Marijn Haverbeke) with a long track record, no
   funding-shaped bus factor — and it is the editor library under Chromium
   DevTools' console, Jupyter, GitHub's own markdown fields, and ByteMD itself.
   ByteMD betting on CodeMirror 5 is, in effect, the strongest possible argument
   for CodeMirror 6.

4. **React 19 / Next 16 fit is clean.** `EditorView` is imperative and expects a
   DOM node, so it mounts in an effect; under StrictMode the double-invoke
   mounts twice and destroys once, leaving exactly one `.cm-editor` in the DOM
   (verified). It imports server-side without touching `document` as long as no
   view is constructed, so `'use client'` plus a dynamic import is sufficient.

The cost, stated honestly: **bundle size**. Measured with esbuild at production
settings, a realistic editor is **187 kB gzipped**, and the tempting
`codeLanguages: languages` from `@codemirror/language-data` more than doubles it
to **560 kB gzipped** — 824 kB of that being `@codemirror/legacy-modes`, every
StreamLanguage mode ever written.

So `@codemirror/language-data` is **not** used. A stateful scan of the corpus
found 64 fenced blocks in **9 distinct languages** (r ×35, py ×9, rust ×6, js ×3,
yaml ×2, javascript/mermaid/html/text ×1, plus 5 with no language). Six language
packages cover every fence that exists, and a fence in an unlisted language is
rendered unhighlighted rather than failing — the same degradation `render.js`
already documents for shiki. `/studio` is behind auth and edits one document at
a time; 187 kB there is not a page-load budget anyone is waiting on, and it is
still smaller than the `language-data` payload we declined.

## What this means for the renderer

Nothing had to change. This was the point of choosing a raw-source editor: no
remark/rehype plugin was modified, no post was migrated, `RENDERER_VERSION` does
not move, and `scripts/db/full-sweep.mjs` still reports 82/83. The one thing the
choice *did* force is that the editor must ship its own theme built from the
blog's design tokens rather than adopting CodeMirror's `oneDark` — see
`src/components/studio/editor-theme.js`.
