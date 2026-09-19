# /studio — the admin area

Design reference: Ghost's admin, for *structure* only (rail, dashboard, list,
editor, settings). Every colour, radius and shadow is a Prologue token from
`src/app/globals.css`. /studio is the blog's admin, not a second application; a
differently-themed panel bolted onto it is the tell that the two were built
separately.

## Layout, and why it is three breakpoints

```
< md   phone    top bar + full-height drawer
≥ md   tablet   persistent 224px rail
≥ lg   desktop  the same rail; content caps itself
```

A 224px rail is most of a 390px viewport, so the phone gets a drawer; a drawer
on a 10-inch tablet is *worse* than a rail, so tablet gets the rail. The break
is at `md`, not `sm`.

## Routes

| route | what it is |
|---|---|
| `/studio/login` | the two-phase sign-in form; the only page outside the shell |
| `/studio` | dashboard: figures, 30-day sparkline, recent edits, top paths |
| `/studio/posts` | the list, filtered by status |
| `/studio/posts/[slug]` | the editor |
| `/studio/posts/[slug]/history` | revision list, diff, restore |
| `/studio/pages` | MDX pages, per-page giscus toggle and custom CSS |
| `/studio/collections` | collection CRUD with custom fields |
| `/studio/media` | the Vercel Blob library |
| `/studio/tags` | the taxonomy |
| `/studio/settings` | 2FA, backup codes, sessions |

### The two route groups

`src/app/studio/(auth)/login` and `src/app/studio/(app)/*`.

A route group adds a directory to the filesystem and *nothing* to the URL — so
`/studio/login` is still `/studio/login`. The split exists because the shell
needs a signed-in user and the sign-in page does not: putting the session check
in the shared layout would redirect the login page to itself, and the author
could never reach the form.

`(app)/layout.js` is therefore the gate. It calls `requireUser()`, which
`redirect()`s, so no page below it can run a query without a session and no
branch exists where "the user is null" could be forgotten.

**Gotcha, learned twice:** a route group *does* add a directory level, so every
relative import under it needs one more `../`. `.tmp/fix-studio-imports.mjs`
resolves each specifier against the file's real directory and repairs the ones
that do not resolve — run it after moving anything under a route group.

## View counts

Read from Umami, which lives in a **separate database on the same cluster**.
`src/lib/studio/stats.js` is the only module that opens a connection to it, and
it is a second pool with `max: 2` because sharing the app's pool would mean one
connection string that can reach both databases.

It **fails soft**: every function returns `null` after the first failure and
stops retrying for the life of the process, so a misconfigured URL cannot turn
every /studio page into a 500 or add a five-second timeout to each render.

`null` is not `0`, and the UI distinguishes them everywhere — `—` in the
figures, an explicit banner on the dashboard. Rendering a confident zero for a
broken connection would tell the author their traffic had vanished.

Counts appear **only in /studio**. Nothing in `src/app/(site)` imports this
module; that is the user's requirement, and it is enforced by the module living
under `src/lib/studio/` rather than by remembering.

## The editor

See `docs/editor-decision.md` for why it is CodeMirror 6 and not one of the
five WYSIWYG candidates.

Three things about the implementation are load-bearing:

**The editor is uncontrolled.** `EditorView` owns the document; React creates it
once from `initialValue` and never writes into it again. A controlled markdown
editor resets the cursor, the undo history and the scroll position on every
render. Everything the parent needs comes back through `onChange`.

**The preview is server-rendered.** The autosave response carries the HTML the
server just produced with `renderMarkdown` — the same call, in the same process,
that wrote the revision. The preview pane only chooses how to *display* it, and
it uses the page's own `OptimizedHTMLRenderer` so `<img>` and mermaid fences
behave identically in both places. There is no second rendering path to drift.

**Autosave is a no-op when nothing changed.** The server compares the SHA-256 of
the new markdown against the stored `content_hash` and writes nothing if they
match. An editor left open on a timer therefore generates zero writes and zero
cache invalidation. This is the property that makes a 2.5s interval defensible.

### Optimistic concurrency

`revision` rides with every save. The server refuses a write whose base revision
it no longer holds, and the client **does not retry** — retrying would overwrite
whatever the other tab wrote, which is the exact thing the check exists to
prevent. The author is told and decides.

### Publish is save-then-publish

Two calls, in that order. The publish path publishes whatever revision the draft
pointer names, and if the browser is holding unsaved keystrokes, those
keystrokes are not it. Reporting "published" for a document one edit behind the
screen is the worst thing a publish button can do.

## The frontmatter panel

The fields are not a form *beside* the document — they are the frontmatter block
*of* it. `patchMeta` writes them back into the text and re-emits every untouched
line from its original source bytes.

This is not a nicety. The corpus writes frontmatter keys in at least three
different orders, so any implementation that re-serialises from a parsed object
would rewrite every frontmatter block in the blog the first time a post was
opened. `scripts/db/check-frontmatter-roundtrip.mjs` asserts the property that
prevents it: `patchMeta(md, readMeta(md)) === md` for all 64 documents, and
changing one field rewrites exactly one line.

## Cache invalidation

`src/lib/studio/cache-tags.js`. Writes use `updateTag`, not `revalidateTag`:
`revalidateTag` marks an entry stale and lets the *next* request recompute it,
which is right for readers but wrong for the author, who has just hit Save and
is about to look at the page. There is one author, so eager invalidation costs
one document.

Two tag families: the collection (`posts`) so a new post appears on /blog, and
the member (`post:<slug>`) so editing one post does not evict the other 62.
