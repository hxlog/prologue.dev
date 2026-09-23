# Vault data files & npm scripts — proposal

**Status:** proposal, nothing implemented. Written 2026-09-23 against
`worktree-spec-plan` (branch `worktree-spec-plan`, HEAD `15ca675`).

**Scope.** Three asks:

1. Turn the files under `data/` that Obsidian cannot open into markdown it can edit.
2. Cut `package.json` scripts down to the essentials, folding the rest into `build`.
3. Decide whether the `npm warn install-scripts` message on `npm i` needs fixing.

Nothing in this document has been applied. Each part ends with options; the
recommended one is marked.

---

## Part 0 — Two defects found while investigating

These are not part of what you asked for, but they change what the other parts
can safely rest on, so they come first.

### 0.1 The offline gates are red right now, and would be redder on Linux

Measured on this worktree:

```
npm run check:content   63 posts compared, 14 problems
npm run check:render    63 posts: 37 expected-diff, 2 unexpected
```

Every `check:content` failure is the same shape:

```
/blog/voter-awakening .description
  ref="取消文化是觉醒资本主义的逻辑。\r"
  got="取消文化是觉醒资本主义的逻辑。"
```

`data/content/blog/` holds **49 CRLF-only files and 14 LF-only files, 0 mixed**.
The 14 LF files are exactly the ones `git status` lists as modified — and
`git diff` is **empty** for all 14, i.e. they are stat-dirty, not content-dirty:

```
ls-files -m:      14
diff --name-only:  0
diff --cached:     0
```

Those 14 have mtimes of `2026-09-22T12:53`, i.e. they were re-saved yesterday —
consistent with an Obsidian save.

Root cause: `git config core.autocrlf=true` and **there is no `.gitattributes`**.
The committed blobs carry CRLF; the working tree no longer does; the fixtures in
`scripts/fixtures/` were captured from a CRLF checkout and bake `\r` into their
expected values. Measured directly against the fixtures:

```
content-shape baseline: 63 entries, 60 contain \r
render baseline:        63 entries, 15 contain \r
```

Why this matters beyond the two gates: **on Linux — CI and Vercel — every file
checks out LF.** Today only 14 files are LF, so `check:content` reports 14
mismatches; on a Linux checkout all 63 would be, so it would report ~60.
`check:render` fares slightly better only by accident: a differing post is
accepted when its slug is listed in `render-fixes.json`, and 13 of the 14 LF
posts happen to be listed — the 2 "unexpected" are the ones that are not. On
Linux, all 15 would diverge.

These two gates are therefore Windows-only today, which means they cannot be
added to CI (Part 2) until this is fixed.

**Fix, before anything else:**

1. Add `.gitattributes` with `* text=auto eol=lf` and renormalize the tree once
   (`git add --renormalize .`).
2. Either re-capture the two fixtures after renormalizing, or normalize both
   sides when comparing. Re-capturing is cleaner — the fixtures exist to pin
   *renderer* behaviour, and line endings are not renderer behaviour.

Until this is done, "the gates are green" is not a claim that travels between
machines.

### 0.2 `package-lock.json` is out of sync with `package.json`

Measured by diffing the lockfile's root entry against `package.json`:

| | lockfile | package.json |
|---|---|---|
| root `dependencies` | 35 keys, **includes `contentlayer2`, `next-contentlayer2`** | 33 keys, both absent |
| `shiki`, `@shikijs/rehype`, `yaml` | **`devDependencies`** | `dependencies` |
| root `devDependencies` | includes **`concurrently`** | absent |

And in the installed tree:

```
$ npm ls contentlayer2
└── contentlayer2@0.5.8 extraneous
└── next-contentlayer2@0.5.8 extraneous

$ npm ci --dry-run
removed 193 packages in 1s      # exit 0
```

`npm ci` accepts it (it validates that every `package.json` dependency has a
satisfying lockfile entry; extras are tolerated and removed), which is why this
has gone unnoticed.

**Consequence that matters:** `shiki` renders every code block during
`next build`. The lockfile classifies it as a *dev* dependency. A
`npm ci --omit=dev` — the normal production install — would produce a build with
no syntax highlighter. Today's CI runs plain `npm ci` so it happens to pass.

**Fix:** run `npm install` once against the current `package.json` and commit
the regenerated lockfile. This also removes three of the four packages in
`npm install-scripts ls` (Part 3).

---

## Part 1 — Making the `data/` files Obsidian-editable

### 1.1 The hard constraint, first

**Obsidian cannot edit `.js` or `.yaml` at all.** The setting *Show all file
types* (formerly *Detect all file extensions*) makes them **visible** in the
file explorer and **linkable** — nothing more. They are not openable, not
editable, and not searchable; Obsidian only searches notes and canvases, and
clicking one hands off to the OS default app. There is no native way to create
or edit a non-`.md` file from inside Obsidian.

So converting to `.md` really is the only way to reach the goal. That part of
the request is right.

### 1.2 What `.md` actually buys you — the boundary

Obsidian's Properties panel supports exactly seven scalar types: **text, list,
number, checkbox, date, datetime, tags**. Lists are lists of *scalars*.

Not supported, per Obsidian's own docs ("Nested properties"):

| Shape | In the Properties GUI |
|---|---|
| `text` / `number` / `checkbox` / `date` | editable |
| list of scalars — `tags: [a, b]` | editable |
| **list of objects** — `- name: x` / `  url: y` | **not editable**, shown as "unknown" |
| **nested object** — `umami: { scriptUrl: … }` | **not editable**, shown as an opaque JSON string |

The destructive half: **any** edit through the Properties panel re-serializes
the *entire* frontmatter block through Obsidian's own library. Comments are
dropped, indentation normalized, flow style expanded. A dataset that merely
*sits* in frontmatter as a list of objects can be mangled by an unrelated edit
to that same note. This is a long-standing, still-open complaint with the
Obsidian team's explicit "this is on purpose".

The ecosystem's answer for "a list of records" is therefore **one note per
record, flat frontmatter** — that is what Bases consumes as rows, what Astro's
`glob()` produces, and what Obsidian's own Airtable importer generates.

### 1.3 Applying that to your five files

| File | Shape | Editable as one `.md`? |
|---|---|---|
| `data/links.yaml` | 9 × `{name, description, blog_url, avatar}` — all scalars | no — list of objects |
| `data/microblog.yaml` | 26 × `{date, content, images[{src,desc}]}` | no — list of objects + nested |
| `data/headerNavLinks.js` | 4 × `{href, title}` | no — list of objects |
| `data/tagLabels.js` | 15-key map | no — nested map |
| `data/sitemetadata.js` | flat, **except** `umami: {…}` | no — nested map |

None is directly representable. Each needs a shape change — but there is a
sharper constraint that decides which ones are even worth converting.

### 1.4 The constraint that decides it: static imports vs `fs` reads

`data/` is consumed two completely different ways:

**Read with `fs` at request/build time (server only):**
- `data/microblog.yaml` → `src/lib/microblog.js`, and a *second, independent*
  reader in `src/app/page.js` (`getMicroblogQuotes`, which duplicates the parse
  and swallows errors with `catch { return [] }`).
- `data/links.yaml` → `src/app/links/page.js`.

**Statically imported by client components** (`"use client"`), so the values
must be in the JS module graph and shipped to the browser:

| File | Client importers |
|---|---|
| `data/sitemetadata.js` | `comments.js`, `email-modal.js`, `footer.js`, `navbar.js`, `rss-modal.js` (×2 imports) |
| `data/tagLabels.js` | `articles.js`, `tag-chips.js` |
| `data/headerNavLinks.js` | `mobilenav.js`, `navbar.js` |

**A `.md` file cannot be statically imported into a client component.** Turning
`data/sitemetadata.js` into `data/site.md` therefore requires a codegen step —
a script that reads the `.md` and writes a `.js` the client can import. That is
precisely the generated-file layer the Contentlayer removal just deleted, with
the same staleness failure mode the loader's `current()` exists to prevent.

So the clean split is:

> **`links.yaml` and `microblog.yaml` can become markdown with no codegen.
> The three `.js` files cannot, unless you reintroduce a generate step or
> thread their values through props from server parents.**

### 1.5 Options

#### Option 1 — Convert the two YAML datasets (recommended)

Five new files replace three (the microblog loader gains a sibling, see below):

```
data/microblog.md     ← replaces data/microblog.yaml
data/links.md         ← replaces data/links.yaml
```

**`data/links.md`** — a GFM table. Four scalar columns, no per-record prose;
Obsidian has a native table editor, and your pipeline already parses GFM.

```markdown
| name | description | blog_url | avatar |
| --- | --- | --- | --- |
| Pathos Page | 哲学片段与学术之路 | https://pathos.page/ | /static/avatars/pathos.page.png |
| 停云馆 | 博学之，审问之，慎思之，明辨之，笃行之 | https://blog.yizhou.ac.cn/ | /static/avatars/blog.yizhou.ac.cn.png |
```

**`data/microblog.md`** — one `##` section per entry, in document order. The
paragraphs become ordinary markdown, images become ordinary embeds, which is
strictly better than the current YAML `|` block and nested `images:` list:

```markdown
## 2026-03-14
<!-- id: mb-20260314-1 -->

正义不是制度的一部分，而是每个人每天都要重新决定的东西。

## 2025-10-12
<!-- id: mb-20251012-1 -->

只有能够保持一种持久的独立的看法的人，才能真正信仰……

![配图说明](/static/microblog/a.jpg)
```

Why the explicit `<!-- id: … -->`: **the current id is broken.**
`src/lib/microblog.js` builds it as `` `mb-${dateKey}-${index}` `` where `index`
is the entry's position in the array. Reordering the YAML silently renumbers
every id after the edit point, breaking page anchors (`/microblog#mb-…`) and
RSS `<guid>`s at once. Ties are common in your data — `2024-12-31` appears three
times, `2025-01-31` several — so date alone is not unique either. An explicit id
is the only stable answer, and moving to a file makes ids auditable by eye.
(The `^block-id` syntax Obsidian uses for block references is an alternative,
but it is a paragraph-level convention and reads oddly on a heading.)

**Build impact:**
- Two new loaders (`data/links.md` table → records; `data/microblog.md`
  sections → entries). Both parse with remark, already in the pipeline.
- `src/app/page.js`'s duplicate `getMicroblogQuotes` reader goes away — it
  becomes a call into the same loader. This removes a second parse path that
  currently disagrees with the first on error handling.
- `src/components/friendlinks.js:70` links to
  `…/edit/master/data/links.yaml`; the path changes.
- `scripts/publish-template.mjs` enumerates `data/links.yaml`,
  `data/microblog.yaml`, `template/data/links.yaml`, `template/data/microblog.yaml`
  in `ensureTemplateInputs()` **and** in the copy block — all four paths change.
  This fails loudly if missed, which is the design.
- `template/` mirrors, `docs/CONTENT.md`'s "What lives where" table, `README.md`,
  `README.template.md`, `CLAUDE.md`.

**Costs and risks:**
- A `|` inside a table cell must be escaped; your current link descriptions have
  none, but a future one would need `\|`.
- Those files become ordinary notes: they appear in search, graph and the quick
  switcher. Mitigate with Settings → Files & links → *Excluded files* patterns
  (`links.md`, `microblog.md`) — note this hides them from search and graph but
  they stay visible in the explorer.
- Existing `/microblog#<id>` links break once ids change shape. There are
  currently no id-bearing URLs you control (the RSS guid is the same URL), so
  this is a one-time reader-visible churn.

#### Option 2 — Convert all five, adding a codegen step

Same as Option 1, plus `data/site.md`, `data/tags.md`, `data/nav.md`, and a
`scripts/generate-data.mjs` that runs in `dev`/`build` and emits the `.js`
modules the client components import. The generated files would be gitignored
and regenerated, exactly like `public/search-index.json`.

- **Pro:** everything under `data/` becomes editable in Obsidian, which is the
  literal ask.
- **Con:** `umami` is a nested object and frontmatter cannot hold it — it has to
  be **flattened** to `umamiScriptUrl` / `umamiWebsiteId` / `umamiDomains` /
  `umamiRecorderUrl`. Same for `tagLabels` (a 15-key map → 15 flat text keys in
  one note, or 15 notes).
- **Con:** it reintroduces generated files. `next dev` would need the generator
  to have run before the first import resolves, and a hand-edit of a generated
  file is silently lost on the next build.
- **Con:** `sitemetadata`/`tagLabels`/`navLinks` are *configuration*, not
  content. They are edited once and never again. The Obsidian benefit is close
  to zero and the machinery cost is a new failure class.

#### Option 3 — Convert nothing; accept VS Code for these five

- **Pro:** zero migration, zero build risk.
- **Con:** does not do what you asked.

### 1.6 Recommendation

**Option 1.** It converts the two datasets that are genuinely *content* — the
ones you actually edit — with no codegen, no new generated-file class, and no
nested-frontmatter exposure. It also fixes the position-based microblog id as a
side effect.

For the three `.js` files, my recommendation is to **leave them as `.js`**. The
one real argument for converting them is that `data/` stops being a single
uniform thing — but it is *already* not uniform (posts, pages, YAML, JS, and
~220 assets), and the deciding factor is that Obsidian's frontmatter model
cannot hold a nested map anyway. If you want `tagLabels` and `headerNavLinks`
in Obsidian regardless, the honest path is Option 2's **third** sub-variant:
move their ten client imports to props from a server parent (the repo already
does exactly this to keep posts out of the client bundle). That is a refactor of
`navbar.js`, `mobilenav.js`, `articles.js`, `tag-chips.js` and their callers —
more code churn than the `.md` conversion itself, for less benefit.

---

## Part 2 — Cutting `package.json` scripts

### 2.1 What exists (16 scripts)

```
dev  build  start  lint
build:content
static:link  static:unlink  static:verify
publish:dry  publish
check:slug  check:render  check:content  check:prerendered  check:feeds  check:template
```

### 2.2 Why "fold everything into `build`" does not work

The instinct is reasonable, but four things block it:

1. **`check:prerendered` reads `.next/server/app/**`** — it validates the
   *output*. It must run after `build`, not inside it.
2. **`check:feeds` fetches all four feeds from a running server.** It needs
   `npm run start` up. Structurally cannot be inside `build`.
3. **`publish-template.mjs` already deletes all six `check:*` scripts** from the
   shipped `package.json`, with a comment saying so:

   > The maintainer's pre-publish gates compare against fixtures under
   > `scripts/fixtures/` and data that the template does not ship. A stranger
   > running `npm run check:render` on a clone would get a confusing failure
   > about a missing baseline, not a useful signal.

   Folding them into `build` means a fresh template clone either fails on
   `npm run build`, or you re-implement the same stripping for a build step.
4. **Measured cost** of the four offline gates:

   | script | wall clock |
   |---|---|
   | `check:slug` | 31.5 s |
   | `check:render` | 15.1 s |
   | `check:content` | 2.4 s |
   | `check:template` | 0.9 s |

   ~50 s added to every build, including the template's.

The deeper reason: `build` *produces an artifact*; the checks *verify
invariants*. They are a different class of thing, and merging verification into
production is how you end up with a gate nobody can turn off.

### 2.3 What can genuinely be deleted or merged

| script | verdict | why |
|---|---|---|
| `build:content` | **delete** | byte-identical to the step `dev`/`build` already run |
| `static:link` | **delete** | `dev`/`build` run it; standalone invocation is never needed |
| `static:verify` | **merge into `check`** | it is an assertion, not a build step |
| `static:unlink` | **merge into `check --unlink`** | a recovery tool, not a workflow |
| `publish:dry` | **fold into `publish`** | flip the default: `publish` = dry run, `publish --push` = real push. A destructive default is the wrong default anyway. |
| `check:*` (×6) | **merge into one dispatcher** | `node scripts/check.mjs [name]`, one entry point, same behaviour |

### 2.4 Proposed surface

```
dev            link + index + next dev
build          link + index + next build
start          next start
lint           eslint .
check          node scripts/check.mjs              # runs every offline gate
check:...      (optional args, not separate scripts)
publish        node scripts/publish-template.mjs   # dry run
publish --push                                     # actually pushes
```

**16 → 6.** If you want exactly five, drop `check` as well and run
`node scripts/check.mjs` by hand — but I would not, because the scripts are
still there and `npm run check` is the discoverable affordance.

`scripts/check.mjs` would be a ~40-line dispatcher that lazy-imports the six
existing modules; it does not need to rewrite any of them. `static-assets.mjs`'s
`verify`/`unlink` become two more subcommands.

### 2.5 The change I would actually prioritise here

`.github/workflows/ci.yml` currently runs `lint` and `build` — **and nothing
else**. The six gates are the only regression protection this repo has and they
never run automatically. Adding `npm run check` to CI is worth more than any
amount of script renaming.

It cannot be done until Part 0.1 is fixed (the fixtures bake in a Windows
checkout artifact), and `check:feeds` still needs a `start` + wait step. A
workable sequence:

```yaml
- run: npm run lint
- run: npm run check          # offline gates, after Part 0.1
- run: npm run build
- run: npm run start & ... check:feeds
```

---

## Part 3 — The `npm warn install-scripts` message

### 3.1 What it is

**npm 12.0.0 (2026-07-08) made dependency install scripts blocked by default.**
It is listed as a breaking change in the npm changelog; the governing RFC is
npm/rfcs#868, motivated by the 2025–26 supply-chain incidents. This is the new
intended default, not a misconfiguration on your machine.

`allowScripts` was introduced earlier (npm 11.16.0, 2026-05-27) as an advisory
preview; npm 12 made it enforcing.

### 3.2 Whether `unrs-resolver` matters

It does not. Three facts, all verified on this worktree:

1. **The postinstall is a no-op in the normal case.** It calls `napi-postinstall`,
   which first tries to resolve `@unrs/resolver-binding-<platform>`. npm already
   installed that package as a direct optional dependency —
   `node_modules/@unrs/resolver-binding-win32-x64-msvc/resolver.win32-x64-msvc.node`
   exists. The download fallback only runs for the old-npm bug
   (npm/cli#4828) it exists to work around.
2. **It loads anyway.**
   ```
   $ node -e "require('unrs-resolver')"
   loaded OK, keys: ['sync','ModuleType','EnforceExtension', …]
   ```
3. **It is dev-only and unrelated to the build.** `npm ls unrs-resolver` shows
   one path: `eslint-config-next` → `eslint-import-resolver-typescript`.
   Next 16 removed linting from `next build`, and `next.config.js` has no
   `eslint` key. `next build` and the running site never touch it.

`npm ci` in GitHub Actions emits the identical warning and **exits 0**.

### 3.3 Recommendation: do nothing

Leaving it blocked is npm 12's safe default working as intended. Nothing in
this repo is broken by it.

If you want the message gone anyway:

- `"allowScripts": { "unrs-resolver": true }` in `package.json` is the only
  mechanism that survives a fresh clone. Note it would also ship to the public
  template — `patchStarterPackageJson()` re-serializes the whole object and only
  strips `scripts.*` keys.
- `--loglevel=error` suppresses it bluntly.
- Passing `--allow-scripts` on the CLI is an **error** for project installs
  (`EALLOWSCRIPTS`), so that is not an option.
- `ignore-scripts=true` would also silence it — but it makes `allowScripts`
  inert, and is a bigger hammer than the problem.

### 3.4 The related thing worth fixing

`npm install-scripts ls` currently lists **four** packages:

```
contentlayer2@0.5.8   (postinstall)
esbuild@0.28.1        (postinstall)
protobufjs@7.6.5      (postinstall)
unrs-resolver@1.12.2  (postinstall)
```

The first three are the dead Contentlayer tree — `npm ls` marks `contentlayer2`
and `next-contentlayer2` **extraneous**. They exist only because the lockfile is
stale (Part 0.2). Regenerating the lockfile removes them, and the warning drops
to the single `unrs-resolver` line you pasted.

---

## Recommended sequence

| # | Change | Why first |
|---|---|---|
| 1 | `.gitattributes` + renormalize + re-capture the two fixtures | makes the gates mean the same thing on every machine |
| 2 | `npm install`, commit the regenerated lockfile | fixes the `shiki`-as-dev-dependency hazard; drops 3 of 4 install-script warnings |
| 3 | `npm run check` in CI | turns six dead gates into running ones |
| 4 | Part 2 — scripts 16 → 6 | cheap, removes the dead duplicates |
| 5 | Part 1 Option 1 — `microblog.yaml` + `links.yaml` → `.md` | the actual ask; largest blast radius, so last |
| — | Part 3 | no action |

Steps 1–2 are prerequisites for 3. Step 5 is independent of 1–4.
