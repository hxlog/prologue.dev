# Prologue.dev — Four-Workstream Plan

**Status:** draft for review
**Date:** 2026-09-21
**Base:** `master` @ `ec86091` (the file-based site, Contentlayer2)

Four independent asks, ordered by risk and by how much they block each other:

| # | Workstream | Risk | Blocks |
|---|---|---|---|
| W4 | Theme transition — 0.618s, composited | low | nothing |
| W3 | Template + README, bilingual, demo-rich | low | nothing |
| W1 | Replace Contentlayer2 with an in-repo content layer | high | W2's rewrite step |
| W2 | Obsidian-editable content + images | medium | W1 |

W1 and W2 interact: W2's recommended option rewrites image paths *and* needs a build-time URL rewrite, which is cheapest to do while W1 is already replacing the pipeline. Doing W1 first means W2's rewrite has one place to live instead of two.

**Explicitly out of scope.** RSC payload size. An earlier claim in this conversation that the homepage ships 139KB of post bodies was wrong on two counts (the numbers came from a different project's dev server, and `src/app/page.js` already maps posts to slim objects before passing them down). It is not a problem and is not in this plan.

**Relationship to `worktree-platform-build`.** That branch is a separate, undeployed generation with its own CLAUDE.md; `master` contains none of it. W1 replaces files that branch also heavily edits (`contentlayer.config.js`, the feed pipeline, every consumer of `allposts`). Expect a large merge; whichever lands second will need manual resolution. Flag: the platform branch already moved content to Postgres, which would make W1 and W2 moot *if* it ships first. Sequence matters.

---

## W4 — Theme-switch transition

**Goal:** the light/dark swap runs at 0.618s and does not stutter, especially on mobile.

### What is actually wrong

Three compounding causes, measured in this repo:

1. **`clip-path` is not composited.** `globals.css:371-382` animates `clip-path: circle(0 → 150%)` on `::view-transition-new(root)`. Clip-path animates on the main thread and forces a re-rasterize of the whole viewport every frame — including the `backdrop-filter: blur(14px)` sticky navbar (`globals.css:272-275`).
2. **A whole-page transition storm runs underneath it.** The build emits 39 transition utilities (25 `transition-colors`, 14 `transition-all`). Tailwind v4's property set for both is `color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-*` — and those are *exactly* the properties the theme tokens flip. So every element on the page independently animates its colors over 150ms while the 618ms reveal runs. That is the "too fast" sensation: the per-element crossfade finishes long before the reveal does.
3. **`backdrop-filter` is re-composited every frame.** On mobile GPUs this is the dominant cost.

### Change

In `globals.css`, inside the `html.theme-vt` scope:

```css
/* During the swap the reveal is the ONLY animation. Per-element color
   transitions would otherwise crossfade on top of it (Tailwind's
   transition-colors/-all include color, background-color and
   border-color — the exact properties the tokens flip). */
html.theme-vt *,
html.theme-vt *::before,
html.theme-vt *::after {
  transition: none !important;
}

/* The sticky glass navbar re-rasterizes its backdrop every frame of the
   reveal. Dropping the blur for the duration is the single biggest win
   on mobile; the header is opaque enough at 618ms that it is not visible. */
html.theme-vt .glass-header {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

html.theme-vt::view-transition-new(root) {
  z-index: 1;
  animation: theme-reveal 0.618s var(--ease-out-expo) both;
}
```

`themeswitch.js` already adds the class before `startViewTransition` and removes it in `.finished.finally()`, so no JS change is needed — but the class is currently removed only when the transition resolves, and if `startViewTransition` throws the class sticks. Add a `.catch()` alongside `.finally()` as a safety net.

Radius: keep `circle(150%)`. With per-element transitions off, the reveal reads as intentional rather than as compound flicker; changing the shape is not needed to hit the goal.

**Reduced motion** already short-circuits (`globals.css:383-388`). Confirm it still does after the `*` rule is added, since `transition: none !important` on a scoped class does not affect `@media (prefers-reduced-motion)` handling of `animation`, but the ordering should be checked in a browser.

### Verification
Chrome DevTools performance trace of the toggle, before and after, on a throttled mobile profile. Success = no long tasks over 50ms during the 618ms window, and the frame rate holds. The current build has a dev server; trace against `npm run build && npm run start`, not dev.

**Conditional:** if the trace shows the mobile stutter persists after (1) and (3), the remaining suspect is `will-change` on the lightbox slides (`globals.css:545,552`) keeping composite layers alive. That would be a separate, smaller change — do not pre-emptively remove `will-change` (a comment at `globals.css:6-12` in `next.config.js` records that removing things pre-emptively has burned this repo before).

---

## W3 — Template and README

**Goal:** the published starter demonstrates the full feature set, in both languages, and looks alive.

### Current state

`template/` holds one post (`hello-prologue.md`, ~28 lines), one page (`about.md`), two screenshots (light only), and English-only config. `README.template.md` documents setup but shows no dark mode and no mobile.

### Change

Content, all bilingual as parallel files (not mixed-language in one file):

- `template/data/content/blog/hello-prologue.md` — zh
- `template/data/content/blog/hello-prologue.en.md` — en
- `template/data/content/blog/feature-tour.md` + `.en.md` — one post exercising **every** renderer feature in one pass: KaTeX inline and block, a code block in a language that shows both Shiki themes, a GFM table, footnotes, strikethrough, task list, a Mermaid fence, a multi-image set that triggers the lightbox grid, a blockquote, and a figure with a caption. Every frontmatter field set at least once: `title`, `description`, `publishDate`, `lastmod`, `image`, `imageDesc`, `draft`, `featured`, `tags`, `categories`.
- `template/data/content/pages/about.md` — zh, rewritten as **plain markdown** (see W1: Page stops being MDX)
- `template/data/content/pages/about.en.md` — en
- `template/data/microblog.yaml` — a few entries including one multi-paragraph and one multi-image, so the card grid and the microblog RSS both look populated
- `template/data/links.yaml` — 3–4 entries instead of 2
- `template/data/headerNavLinks.js` — currently Chinese titles while `sitemetadata.js` is `language: "en-US"`. Pick one default (English, since the template's README is English-first) and make the README say how to change it.

Screenshots: recapture `public/static/images/` with dark mode and a phone viewport. Four images: home light, home dark, post light, mobile. The two existing files (`Index-Screenshot.jpg`, `Post-Screenshot.jpg`) stay where they are; add `*-dark.jpg` and `Mobile-Screenshot.jpg`.

`README.template.md`: add a bilingual overview section (Chinese below English, same content), a feature list that matches what `feature-tour.md` actually demonstrates, and the Obsidian workflow if W2 lands. Keep the "5 Things To Change First" list — it is good.

### Verification
`npm run publish:dry` and inspect `.tmp/template-worktree`: confirm it contains exactly the starter content, no author posts, no `CLAUDE.md`, no `.obsidian` (see W2 leak). Then build the snapshot to confirm it compiles.

---

## W1 — Replace Contentlayer2

**Goal:** no second process, no webpack plugin, Turbopack-native, build-time prerendering preserved, **zero change to rendered output**.

### Why replace it

- It is a webpack plugin by construction (`next-contentlayer2/dist/index.js` pushes `ContentlayerWebpackPlugin` through `webpack(config, options)`). That is why `next.config.js` carries an empty `turbopack: {}` and why `concurrently` exists.
- Upstream is stalled: `contentlayer2`'s newest release is `v0.5.8`, 2025-05-03; the Turbopack incompatibility issue (#74) and the "does it support Next HMR" issue (#82) are both open and unanswered. The fork's own README says the project's future is "on-going discussion".
- It warns on every boot on this platform: `Warning: Contentlayer might not work as expected on Windows`.

### What we get instead

An in-repo content layer: `src/lib/content/`, server-only, reading `data/content/**` with `fs` and running the **same unified pipeline** that `contentlayer.config.js` configures today.

This is the documented Next 16 pattern, not a workaround. The bundled Next 16 docs (`01-app/01-getting-started/08-caching.md:387`) state: *"module imports, synchronous I/O, and pure computations produce the same result every time they run. Components using only these operations are prerendered automatically, and their output becomes part of the static HTML at build time."* `fs.readFileSync` is named explicitly.

### The evidence that makes this safe

A plain `unified` chain reproduces `post.body.html` **63/63 byte-identical** across the real corpus. The chain, in order:

```js
remarkParse
remarkRehype            // ← NO options. See below.
remarkGfm
remarkMath
remarkGemoji
rehypeKatex { strict: false, trust: true, output: "htmlAndMathml" }
rehypeSlug
rehypeFigure            // src/components/rehype-figure.js, reused as-is
rehypeMermaidPre        // src/components/rehype-mermaid-pre.js, reused as-is
rehypeShiki { themes: {light:"material-theme-lighter", dark:"material-theme-darker"}, defaultColor:false }
rehypeStringify         // ← NO options
```

**The load-bearing detail.** `contentlayer.config.js:129` lists `remarkRehype` with no options object, so it runs with `allowDangerousHtml` at its default (off) and raw HTML blocks in the source collapse to their text content — `<sup>季节性分析</sup>` becomes `<p>季节性分析</p>`. Three posts depend on this. Passing `allowDangerousHtml: true` (the intuitive "we want HTML to work" choice) changes all three. The rule: **do not add options to `remarkRehype` or `rehypeStringify`.** A regression test locks this in (below).

### Shape

```js
// src/lib/content/index.js  — server only
import "server-only";
export const allPosts   // same shape contentlayer emitted
export const allPages
export function getPost(slug)
```

Consumers change one import line: `from "contentlayer/generated"` → `from "../lib/content"` (10 files, 33 usages). Field-for-field shape is preserved so no consumer logic changes:

| field | note |
|---|---|
| `title, description, publishDate, lastmod, image, imageDesc, draft, featured, tags, categories` | straight from frontmatter |
| `slug` (`/blog/foo`), `urlslug` | `/` + flattenedPath, lowercased |
| `slugAsParams` (`foo`) | flattenedPath minus the type dir, lowercased |
| `readingTime` `{text,minutes,time,words}` | `reading-time`, `wordsPerMinute: 1000` (CJK choice — keep it) |
| `headings` | `[{level,text,id}]` — **fix the id, see below** |
| `body.raw`, `body.html` | raw source, rendered HTML |
| `_raw.flattenedPath` | used by one consumer |

`page.body.code` disappears: `Page` becomes plain markdown rendered to HTML through the same chain, and `about.md` loses its JSX. `src/components/mdxcomponent.js` — the only `useMDXComponent` consumer — is deleted. Page images go through the same `rehypeFigure`/`lightbox-image` path as post images, which is *more* consistent than today, where MDX images were hand-tagged by `mdxcomponent.js`.

### Two defects to fix in passing

Both are real, both are in the code being replaced, neither is a behaviour change to a *working* feature (the second is a behaviour change to a *broken* one):

1. **TOC anchors are broken for 15 of 404 headings.** `src/components/toc.js:105` builds `href={\`#${heading.text}\`}` — the raw heading text — while the DOM ids come from `rehypeSlug`'s GitHub-style slugifier. Headings ending in `？`, containing `（）`, or with trailing `-` mismatch: `风险究竟是什么？` links to an id that is actually `风险究竟是什么`. Fix: compute `headings[].id` from the same slugger `rehypeSlug` uses, and have `toc.js` link `#${heading.id}`. This is why the plan gives `headings` a single source of truth rather than three implementations.
2. **Silent post loss on malformed frontmatter.** Contentlayer warns and *skips* a document whose field types do not match, exits 0, and CI stays green — a post can vanish from the site with no failure. The replacement validates and **throws**, naming the file and field. (This matters more once Obsidian is in the loop — see W2.)

### Performance

Measured on the real corpus (63 posts, 13 with code fences):

| | |
|---|---|
| `contentlayer2 build` (status quo) | 13.3s |
| unified, markdown only | 1.6s |
| unified + Shiki, cold | 13.4s |
| unified + Shiki, warm | 1.2s |

The cost is Shiki's cold start — loading the R/Python/Rust grammars and both themes — not markdown. Contentlayer pays the same 13s. So the migration is not a build-time win by itself, and the plan should not claim one. What it *does* buy:

- **One process instead of two.** `npm run dev` becomes `next dev --turbopack`. No `concurrently`, no `contentlayer2 dev`, no race on `.contentlayer`.
- **No webpack.** `turbopack: {}` and the `withContentlayer` wrapper both go.
- **Lazy per-route compilation.** Frontmatter, `readingTime` and `headings` are cheap and computed eagerly for all posts. `body.html` requires Shiki and is computed **on demand, memoized**. A dev session that opens three posts compiles three, not sixty-three; the homepage never pays Shiki at all. Production prerender touches every post page and so compiles everything, but in parallel across the build's render workers instead of one serial loop.
- **The highlighter is a module-scope singleton**, so the cold-start cost is paid once per process rather than once per post. This is the 13.4s → 1.2s difference.

Not claimed: "the site builds faster". It does not, materially, on this corpus. It builds *simpler*, and dev iteration gets dramatically cheaper.

### Files

**Add:** `src/lib/content/index.js` (public API), `src/lib/content/pipeline.js` (the unified chain, reusing the two existing custom plugins unchanged), `src/lib/content/load.js` (fs walk, frontmatter parse, validation, memoization).

**Delete:** `contentlayer.config.js`, the `contentlayer2` + `next-contentlayer2` deps, `src/components/mdxcomponent.js`, and from `package.json` the `contentlayer2`/`concurrently` calls in `dev`/`build`/`build:content`.

**Edit:** `next.config.js` (drop `withContentlayer` and `turbopack: {}`), `jsconfig.json` (drop the `contentlayer/generated` path entry), `scripts/build-search-index.mjs` (read from the new module instead of `.contentlayer/generated/Post/_index.json`), `.gitignore` (`.contentlayer` → nothing; the new layer generates nothing on disk), `scripts/publish-template.mjs` (drop the `.contentlayer` wipe), the 10 consumer files' import lines, `data/content/pages/about.md` (drop JSX).

**Dependencies:** add `gray-matter` (frontmatter + the custom-YAML-engine behaviour that avoids date coercion) and `server-only`. Both are already present in `node_modules` transitively; both are tiny and stable. Everything else in the pipeline is already a direct dependency.

### Verification

Ordered, and each is a hard gate:

1. **Equivalence harness.** A checked-in script that compiles every post with the new pipeline and diffs against the captured Contentlayer output (a fixture committed under `scripts/fixtures/`, since `.contentlayer` is regenerated and gitignored). Must report 63/63 before anything else is reviewed. This is the test that catches the `remarkRehype` options trap and any future plugin change.
2. **Full build.** `npm run build` green, then `next start` and diff rendered text of `/`, `/blog`, every `/tags/*`, and a sample of post pages against the pre-migration build. The platform branch's `full-sweep.mjs` is a good model for this even though it targets Postgres.
3. **Feed equivalence.** `/rss`, `/atomfeed`, `/jsonfeed`, `/microblog/rss` — byte-compare against the current output, expecting difference only in `lastBuildDate`.
4. **Dev loop.** `npm run dev`, edit a post body, refresh, confirm the change appears without restarting anything. (Verified to work for `fs`-read content under Turbopack, but re-confirm inside this repo.)
5. **`lint`.**

---

## W2 — Editing `data/` with Obsidian, including images

**Goal:** open one vault, edit posts and their images, see images render in Obsidian's preview, paste new images, and have `git clone` reproduce all of it for someone else.

### The core problem

Markdown references images as root-absolute `/static/photos/06.jpg` (194 refs, 187 unique, 100% in this form), but the files live in `public/static/`, outside `data/`. Obsidian resolves a leading `/` as a **vault-root** path, so `/static/...` only works if `static` exists at the vault root.

### Options, and why three of them fail

**Junction `data/static` → `public/static`.** Verified that Node — and therefore Obsidian, which is Electron — reports a Windows junction as `isSymbolicLink: true, isDirectory: false`. The path math is right and reads work through it, but the standard `readdir` + `dirent.isDirectory()` walk skips it, so the vault indexer very likely never sees the images and they do not render. Two further problems: `git add -A` recurses *through* the junction and stages the entire `public/static` subtree a second time as regular files (it is invisible to git as a link), permanently duplicating those paths; and a junction cannot be committed, so a fresh clone gets nothing. **Rejected** — the render behaviour is unverified and the failure mode is silent.

**Vault at the repo root.** Does not fix it: the file is `public/static/photos/06.jpg`, so `/static/...` still fails to resolve. You would need a second junction at the root, which is the previous option plus 75,077 extra files of `node_modules` to index. **Rejected** — strictly dominated.

**An Obsidian plugin that resolves web-root paths.** Plugins in this space rewrite the markdown *source* on paste; they do not intercept the preview renderer. Rewriting source helps new images and does not make the existing 194 refs render. **Rejected as a primary strategy.**

**Obsidian's attachment-folder setting pointed at `public/static`.** Not possible: the setting offers four vault-relative choices and cannot reference a path outside the vault.

### The recommendation: co-locate images with the post, rewrite at build time

```
data/content/blog/the-post/index.md     ← ![](photo.png)          unchanged source
data/content/blog/the-post/photo.png    ← the file
```

Markdown uses a **truly relative** `![](photo.png)` — the one resolution mode Obsidian both documents and writes natively. A remark plugin rewrites the src during the W1 pipeline to a path the app serves. Because W1 is already replacing the pipeline, this is a ~15-line plugin rather than a second system.

Serving: a route handler streams from `data/content/blog/` with a path-traversal guard and correct `Content-Type` and cache headers. `next/image` treats it as a local same-origin path, so no `images.remotePatterns` and no `localPatterns` are needed, and the existing `contentDispositionType: 'inline'` fix continues to apply. The `lightbox-image` class arrives via the existing `rehype-figure`, unchanged.

Obsidian settings that close the loop: **Default location for new attachments → "In subfolder under current folder"**, so paste writes `![](photo.png)` next to the note — exactly what the rewriter expects. Nothing needs to be copied manually.

This is the only option that satisfies all four constraints: renders in Obsidian (native resolution mode), survives `git clone` as plain files, is platform-independent, and does not disturb feeds or `next/image`.

**Cost.** A one-time, scriptable migration: 187 files moved, 194 refs rewritten, 15 frontmatter `image:` fields updated. Six images are shared between two posts each
(`ridge-vs-lasso.jpg`, `bitcoin-forecast-180-0.95.png`, `Unemployment-Rate-Forecasting.png`, `This-Is-What-Inequality-Looks-Like.webp`, `Rplot_000300_prcomp.jpeg`, `AR-regressive-generative-architectures.jpg`) — these go to a `data/content/blog/_shared/` directory that the rewriter also understands, rather than being duplicated.

**It does not cover everything.** `sitemetadata.js` (`avatar`, `favicon`, `cover`), `data/links.yaml` avatars and `data/microblog.yaml` images stay in `public/static` and stay referenced as `/static/...` — those are site configuration, not post content, and `public/static` is the correct home for them. So there will be two image locations, and the README must say so plainly. Microblog entries keep working in Obsidian too, since they are YAML with `/static/...` paths that Obsidian simply will not preview — acceptable for short posts.

### What Obsidian does to frontmatter

Checked against the real pipeline rather than reasoned about:

- **Dates are safe.** Contentlayer installs a custom YAML engine specifically to avoid date coercion; `publishDate: 2023-01-01` and `publishDate: "2023-01-01"` are identical after parsing, both becoming `2023-01-01T00:00:00.000Z`. Obsidian's Properties panel also stores dates unquoted. No mitigation needed.
- **Booleans are a landmine.** `draft` and `featured` typed as `"false"` (a string) currently cause the post to be **silently dropped with a green build**. Two mitigations, both in plan: set `draft` and `featured` to **Checkbox** property type in the vault (persisted in `.obsidian/types.json`, which stays local), and make the W1 loader **fail loudly** on type mismatch instead of skipping. The second is the one that actually protects the site.
- **Unverified:** whether Obsidian rewrites frontmatter it does not touch, and whether it drops unknown keys (`imageDesc`, `lastmod`, `categories`). Cheap to settle empirically during implementation: copy a post into a scratch vault, edit only the body, `git diff` it. This is step 1 of the workstream, not an assumption.

### The leak to fix regardless of which option wins

`data/.obsidian/` — created the moment you open `data/` as a vault, and it can carry plugin data including credentials (the user's other vault runs Livesync). Today:

- `publish-template.mjs:170-171` wipes only `data/content/blog` and `data/content/pages`
- `commitSnapshot()` runs `git add -A`
- `.gitignore` has no entry for it

So it ships to the **public** template repo. Fix in the same change as the W2 work: add `/data/.obsidian/` to `.gitignore` and an `rmSync` of `data/.obsidian` to `applyStarterTemplate()`. If the co-location option is taken, add `data/static/` to `.gitignore` too as a belt-and-braces guard.

### Verification
1. Scratch vault over a copy of `data/`, edit a body, `git diff` — confirm frontmatter is untouched.
2. Open the real vault, confirm images render in Reading view for a post using both a co-located image and a shared one.
3. Paste a new image in Obsidian, confirm it lands next to the note and renders on the site after a refresh.
4. Full build + the W1 equivalence harness (image refs are part of `body.html`), plus a lightbox check.
5. `npm run publish:dry` and confirm the snapshot has no `.obsidian`, no author images, and no author posts.

---

## Sequencing

1. **W4** — small, isolated, immediate. Ship on its own.
2. **W3** — independent of the pipeline. Can run parallel with W1, but its `feature-tour.md` should be written *after* W1 so it can be verified against the final renderer. Practically: write the content, publish-verify last.
3. **W1** — the big one. Equivalence harness first, then the swap, then consumers.
4. **W2** — depends on W1 for the rewrite plugin and the loader's validation behaviour. Migration script after.

## Open items carried forward

- Ordering against `worktree-platform-build` (see above) — decide before starting W1.
- The `data/.obsidian` template leak should ship even if W2 is deferred entirely.
