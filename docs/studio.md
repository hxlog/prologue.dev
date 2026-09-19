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

Content sits inside `<main class="mx-auto max-w-5xl px-4 …">`, so a 375px phone
has **~343px** of usable width. That is the number every fixed width in the
studio is measured against, and it is why:

- the posts and redirects lists are a `<table>` behind `sm:` with a separate
  phone list underneath, rather than a table that scrolls sideways;
- the editor's source and preview panes are `lg:flex-row` with a sticky
  `Markdown / 预览` switcher at the bottom on a phone — one pane at a time, the
  same two panes, not a shrunken side-by-side;
- the media library is `lg:grid-cols-[1fr_20rem]`, one column below it;
- the frontmatter panel's two date fields stack until `sm:`. A native
  `<input type="date">` has a browser-defined intrinsic width that does not
  shrink below its rendered text plus the picker button, so two side by side in
  ~160px each clip their own calendar affordance;
- icon buttons are 28px (`h-7 w-7`). That is under the 36px a thumb wants and
  it is a deliberate trade: the alternative is a row of controls that reads as
  buttons rather than as chrome, and every one of them has a text or label path
  too. The phone-only controls — the drawer, the top bar, the editor's tab
  switcher — are all ≥32px.

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
| `/studio/settings` | 2FA, backup codes, sessions, the redirect table |

### What each screen can do to a thing, and what it cannot

Written down because the gaps are invisible from inside the app: a missing
button looks the same as a feature nobody wanted.

| | create | edit | rename | publish | delete |
|---|---|---|---|---|---|
| post | yes | yes | yes — dialog, writes a redirect | yes | yes — type the slug |
| page | yes | yes | yes — dialog, writes a redirect | yes | yes — type the slug |
| collection | no, see below | entries and fields | no | per entry | per entry — type the anchor |
| media | yes | alt and caption | no, see below | n/a | yes; `force` offered once the references are shown |
| tag | yes | label | yes — a slug rename leaves an alias | n/a | yes; a second confirmation when posts carry it |

Three entries in that table are deliberate rather than unfinished.

A collection has **no create button** because a collection is data plus a PAGE
that renders it with components written for its shape — creating a third one
would produce rows nothing displays. The list screen says so rather than
implying otherwise.

Media has **no rename** because a pathname is generated on the server and never
chosen by the client (see the Media section). The searchable, editable name is
`original_name`.

**Reordering exists only for a `manual` collection.** `sort_pinned` and
`sort_order` are read in the `manual` branch of the entries query, and a `date`
collection orders by `published_at` first — so a move would appear to do
nothing. The arrows are not rendered rather than rendered and inert.

The rename rows in that table are also why the two public catch-all routes
resolve a retired path: `/blog/[...slug]` for posts and `/[...slug]` for pages,
both reading the same `redirects` table. Without that lookup a rename is
destructive rather than cosmetic — every inbound link and every `<link>` in an
already-delivered feed 404s. The post route was missing it until
`journey-test.mjs` was written, which is the argument for that test existing.

## The two route groups

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

## The palette, and why four values in it are surprising

Every colour in /studio is a token from `globals.css` — that is the whole reason
it does not look like a second application bolted onto the blog. What is worth
writing down is that those tokens were **measured**, not chosen, and four of
them read as odd until you know what they are solving:

**`--faint` is the floor.** It carries 174 timestamps, hints, revision numbers
and counts in the studio, at 10–12px. It was `#a1a1aa`, which is 2.33:1 on
`--surface-2` — a value nobody picks deliberately, and invisible as a problem
because dim text looks *intentional*. The grey ramp moved one step in each
mode; the value that used to be `--muted` is what `--faint` holds now, and the
two tiers are still 1.5× apart so nothing reads flat.

**`--on-accent` flips.** White in light mode, near-black in dark. This is
arithmetic, not taste: white on cyan-400 is 1.81:1 and near-black on it is
11.01:1, while white on cyan-700 is 5.36:1 and near-black on it is only 3.71:1.
No single label colour is legible on both modes' accent, and the alternative —
a dark-mode accent dark enough for white — throws away the palette. So the
token flips, and `--on-accent` is what a brand fill carries.

**The light-mode gradient is darker than the dark-mode one.** As declared,
`#06b6d4 → #8b5cf6` measured 2.43:1 for white at its cyan end. Every brand
button in the app was white text over it. Dark mode is fixed by moving the
*label* and keeping the 400s; light mode had no such latitude, because a
mid-tone that carries white text has to be dark, so the gradient is now
cyan-700 → violet-600. The hue is unchanged — the same ramp, one step down.

**A brand button cannot hover with `opacity`.** `opacity` composites the whole
element, label included, toward the page behind it, so `hover:opacity-90` drags
a passing button *under* AA while the pointer is on it. `.btn-brand` and
`.btn-danger` hover with `filter: brightness()` instead, which moves the fill
and leaves the label where it is.

The last three would each be "fixed" back into failing by anyone reading the
code without this note, which is why `scripts/studio/contrast-audit.mjs` reads
the declared values out of `globals.css` and re-derives every ratio. Retune a
token and it goes red — that is the mechanism, and the audit was verified
against four deliberate regressions before it was trusted.

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

A third tag, `media`, does not follow that shape and is worth knowing about
because it is invalidated by things that are not media writes. It covers two
reads that move together: the library listing, and `isMediaPublished` — the
answer `/api/img` gives a request with no session. Publishing a POST is what
makes its images public, so `invalidatePost` drops `media` as well. Without
that, an image uploaded into a draft and then published would keep answering
"not published" and a reader would get a 404 for a picture visibly in the post
in front of them.

## Media

Bytes live in a **private** Vercel Blob store; `media` rows hold the metadata.
Neither is reachable without the other, and the join is `/api/img/<pathname>`.

**Why private.** A public store is a bucket anybody can enumerate. The moment
the library is writable from the studio, that becomes "anybody can list
everything ever uploaded, including the screenshots in a draft that never
shipped". `scripts/studio/blob-probe.mjs` asserts the store answers 403 to an
unauthenticated fetch — the check is worth keeping runnable because
`access: 'private'` is an argument on every call rather than a property of the
store, so the same code against a public store would succeed and serve the
object to the world.

**The upload is three steps and the middle one is in the browser.**

1. `beginUpload` decides the pathname, checks the declared type and size, and
   returns a presigned PUT. Nothing is written yet.
2. The browser PUTs the bytes straight to the store. A 12 MB photo through a
   serverless body limit is either refused or slow and expensive, and the point
   of a presigned URL is that this leg does not exist.
3. `commitUpload` asks the store whether the object is actually there — with
   `head()` — and only then writes the row.

Step 3 is the one that is easy to skip. It is the difference between a library
whose rows are facts and one whose rows are intentions: a row written at step 1
leaves broken thumbnails the first time a tab is closed mid-upload.

`scripts/studio/blob-signing-probe.mjs` asks the store what a presigned URL
actually pins, because "the constraint is in the signature" is a claim that has
to be tested rather than assumed. Four answers, all measured against the real
store on SDK 2.8.0:

| client tries to | result |
|---|---|
| keep a pathname unchanged, no `addRandomSuffix` | kept — the default is **false**, on `put()` and `presignUrl()` alike |
| swap the pathname in the signed URL | **403** — the path is part of the signed query, so a ticket is a ticket for one object |
| send a body over `maximumSizeInBytes` | **403** |
| send a Content-Type outside `allowedContentTypes` | **200**, and the object is stored with the type the *signature* declared |

That last row is the one worth reading twice. The type constraint is enforced by
OVERWRITING rather than by refusing, which is the safe half of those two options
and not the half a reader would assume from "refused at storage". It is why
`commitUpload` re-reads the type with `head()` instead of trusting the request,
and why the proxy sends `nosniff` — the type a browser sees is the one from our
own row, never the one a client claimed.

`addRandomSuffix: false` is still passed explicitly at every call site. The
default is on our side, but a default is not a promise, and the failure it
guards against is silent: the object lands with four characters appended, the
server's `head()` on the promised pathname answers "does not exist", the commit
refuses, and the store holds bytes no row points at.

**A pathname is generated on the server and never chosen by the client.** It is
`media/<year>/<month>/<8 hex>-<slug>.<ext>`: the date makes the store browsable
as a timeline, the random prefix is what makes a URL unguessable, and the
extension is derived from the MIME type rather than copied from the filename.
`isMediaPathname` is the anchored regex that the proxy validates against, which
is what makes `../`, a query string, a percent-encoding trick or an absolute URL
unrepresentable rather than merely rejected.

**Serving.** `/api/img/<pathname>` is the only way any image is served. An
object referenced by a PUBLISHED post or page is served to anyone — it has to
be, because `next/image` fetches it server-side with no cookie and every feed
reader does too. Anything else needs a session, and answers **404, not 403** to
a stranger: a 403 would confirm an object is there, and the set of things a
stranger can learn about unpublished work should be empty. Published responses
carry `immutable`; session-only ones are `no-store`.

**Deleting is refused while anything references the object**, searched across
`post_revisions.html`, `page_revisions.markdown`,
`collection_entries.values::text` and the `posts.cover_image` column — four
stores that keep the URL in four different shapes. Missing one is how a
published page ends up with a broken image. The refusal carries the counts, and
`force` is only reachable from a second confirmation that has already shown
them.

That fourth one is worth a sentence because it was missed. A cover set through
/studio lives ONLY in `posts.cover_image`; it is never part of the document, so
it is not in any revision's HTML. A post whose only image was its cover
therefore had a cover that answered 404 to every reader — `next/image` fetches
without a cookie and a stranger gets the "not published" answer — while the
author, who has a session, saw it perfectly. The same omission made the delete
guard refuse with a count the dialog did not know how to display, so the author
was told "in use by ." and blocked. `journey-test.mjs` found both on its first
run against an uploaded cover, which is the argument for a test that drives the
browser's own three-step upload rather than the module beneath it.

`scripts/studio/media-reconcile.mjs` is the one thing that reads the STORE
rather than the database. It reports blobs with no row (a commit that failed
after a successful PUT — invisible by definition) and rows with no object
(deleted in the Vercel dashboard), and only deletes either under `--fix`.
