# Editing content with Obsidian

The `/data` directory is a self-contained Obsidian vault: posts, pages, the
markdown data files, **and every static asset the site serves**. One Obsidian
window reaches all of it, so a post and the images inside it are edited in the
same place.

This is a plain-directory arrangement. Obsidian is not required, nothing in the
build depends on it, and editing the same files in VS Code or vim works
identically.

## One-time setup

1. **Open the vault.** Obsidian → **Open folder as vault** → choose the `data`
   directory (**not** the repository root — see [Why the vault root is
   `data/`](#why-the-vault-root-is-data) below).
2. **Set the attachment folder.** Settings → **Files & Links** → *Default
   location for new attachments* → **In the folder specified below** → enter:

   ```
   static/images
   ```

   This is a vault-relative path, so it lands in `data/static/images/`. Pasted
   and dragged-in images go there and are immediately served at
   `/static/images/<file>`.
3. **Set the property types.** These are stored in
   `data/.obsidian/types.json`, which is gitignored — so each machine needs
   them once. Either paste the file below into `data/.obsidian/`, or set the
   types by hand in any note's **Properties** panel (right-click a property
   name → *Change type*).

   ```json
   {
     "types": {
       "title": "text",
       "description": "text",
       "publishDate": "date",
       "lastmod": "date",
       "image": "text",
       "imageDesc": "text",
       "draft": "checkbox",
       "featured": "checkbox",
       "tags": "multitext",
       "categories": "multitext",
       "keywords": "multitext"
     }
   }
   ```

   `keywords` (in `data/site.md`) is the one property in this vault that must be
   a list outside `content/`; everything else in `site.md` is text.

**`draft` and `featured` MUST be `checkbox`.** Typed as text, Obsidian writes
`draft: "false"` — a *string*, which is truthy in every language that matters
and which the build now rejects outright rather than silently dropping the
post. If the build fails with

```
[content] data/content/blog/some-post.md: "draft" must be a boolean, got "false". In Obsidian, set this property's type to Checkbox.
```

that is this setting, and the message names the file and the fix.

### Why the vault root is `data/`

Markdown in this repo references images with a **leading slash** — the same
form the browser and the feed readers need:

```markdown
![caption](/static/images/foo.jpg)
```

Obsidian resolves a leading `/` against the **vault root**, so that link
resolves to `<vault>/static/images/foo.jpg`. Rooting the vault at `data/`
therefore lands on `data/static/images/foo.jpg` — the real file. Rooting it at
the repository root instead would send the same link to `<repo>/static/…`,
which does not exist.

This was read out of Obsidian's own code, not guessed. `getLinkpathDest` in
the shipped `app.js` strips exactly one leading slash and then requires a
**case-insensitive exact match** against a `TFile.path`, with an explicit
`if (linkpath.startsWith("/")) return []` on the failure path. That early
return is the important part: for a leading-slash link there is no basename
fallback and no suffix search, so "close enough" never resolves. One
consequence worth knowing: **renaming or moving an image inside Obsidian can
strip the leading slash**, because Obsidian's link updater writes the path the
way its own "absolute path" setting generates it — without one. If the site
build is fine but Obsidian shows a broken image, that is almost always this.

Rooting at `data/` also means the vault indexes ~220 asset files and 69
markdown files instead of the repository's 75,000-file `node_modules`, so
indexing is fast and no exclusion list is needed.

### Why there is no link or junction inside the vault

An earlier draft had the vault at the repository root with `public/static`
junctioned in. That is the arrangement Obsidian **silently ignores**: its
symlink handler `realpath`s the link and skips it whenever the target is the
vault root, inside it, or a parent of it — the documented "symlink targets
must be fully disjoint from the vault root". A junction from inside the vault
to a folder inside the same vault is exactly the disallowed case, so the link
would exist, be indexed by nothing, and show up as an empty folder.

The current arrangement has no link anywhere. `data/static/` is a real
directory inside the vault; `public/static` is the link, and it points
*outward* at `data/static`, from a directory Obsidian never sees.

## What lives where

| Path | What it is |
|---|---|
| `data/content/blog/*.md` | Posts. Add a file here and it appears on the site. |
| `data/content/pages/*.md` | Standalone pages, e.g. `about.md` → `/about`. |
| `data/static/images/` | Illustrations referenced from posts. **Pasted images land here.** |
| `data/static/photos/` | Cover images. |
| `data/static/avatars/` | Avatars, e.g. for `data/links.md`. |
| `data/static/favicons/` | Site icon, author avatar, default cover. |
| `data/microblog.md` | Microblog entries. |
| `data/links.md` | Friend links. |
| `data/site.md` | Site title, author, URL, Giscus and analytics IDs. |
| `data/tags.md` | Tag slugs and the labels the UI renders for them. |
| `data/headerNavLinks.js` | Navigation bar links. |
| `data/sitemetadata.js` | **Generated** from `data/site.md`. Do not edit. |
| `data/tagLabels.js` | **Generated** from `data/tags.md`. Do not edit. |

`headerNavLinks.js` is a `.js` file because client components import it
directly and a browser cannot import markdown; Obsidian shows it under *Show
all file types* but cannot open or edit it. Edit it in an editor.

## The two generated modules

`data/sitemetadata.js` and `data/tagLabels.js` are read by **client**
components, so their values have to be in the JS module graph and shipped to
the browser — a browser cannot import markdown. They are therefore generated
from the two notes `data/site.md` and `data/tags.md`:

```bash
npm run site-data     # regenerate both from the notes
```

`npm run dev` and `npm run build` run it for you. **The generated files are
committed**, so a clone builds without the generator having run, and every
change to `data/site.md` or `data/tags.md` shows up as a reviewable diff in
the `.js` file rather than as a silent change at build time. `npm run check`
fails if the two disagree.

`data/site.md` is plain frontmatter — edit it in the Properties panel. Two
things there are not obvious:

- **`keywords` is a LIST**; everything else is TEXT.
- **The four `umami*` keys are one analytics block.** Frontmatter cannot hold
  a nested object (Obsidian shows one as an opaque JSON string and rewrites it
  on any unrelated edit), so the block is flattened in the note and folded back
  into `siteMetadata.umami` by the generator. Set all four or none — a
  half-filled block fails the generator rather than shipping a script tag with
  the wrong host.

`data/tags.md` is a GFM table, one row per tag: `slug` is what appears in post
frontmatter and in `/tags/<slug>` URLs, `label` is what the UI renders. Slugs
must stay ASCII; only the labels are translated. A tag with no row falls back
to showing its slug.

`public/static` is a **link**, not a folder — it points at `data/static` so
Next can serve those files at `/static/*`. It is created by
`scripts/static-assets.mjs link`, which `dev` and `build` run for you, and
re-asserted by `npm run check`. Never edit through it; edit `data/static` and
the link follows.

## The microblog and links notes

`data/microblog.md` and `data/links.md` are ordinary notes — edit them in
Obsidian like any other.

**`data/links.md` is a GFM table**, one row per friend. Obsidian has a table
editor for it. A `|` inside a cell must be written `\|`.

**`data/microblog.md` is a series of `##` sections.** The heading is the date,
the section body is the entry, and paragraphs and images are ordinary markdown
— which is why an image caption shows up in the lightbox:

```markdown
## 2026-03-14
<!-- id: mb-20260314-23 -->

正文第一段。

![配图说明](/static/photos/a.jpg)
```

The `<!-- id: … -->` line is the entry's **permanent anchor**: it is what
`/microblog#mb-…` and the RSS `<guid>` point at. Do not edit or delete one, and
when you move an entry, move the whole section, id included. (The id is stored
rather than computed on purpose: a computed id derived from a date plus
position renumbers every later entry the moment you insert one, silently
breaking every anchor and every feed reader's unread state.)

The heading must be exactly `YYYY-MM-DD`, and a missing or duplicate id fails
the build naming the section.

## Adding an image

1. Paste or drag the image into a note. It is saved to `data/static/images/`.
2. Reference it in the note with a leading slash:

   ```markdown
   ![描述文字](/static/images/<file>)
   ```

   The description in the square brackets becomes the lightbox caption.

That is the whole workflow — the file is already in the vault, so Obsidian's
preview and the site both resolve the same path.

**After a rename, check the reference.** Moving or renaming the image inside
Obsidian rewrites the links that point at it, and the rewritten form drops the
leading slash (see [Why the vault root is
`data/`](#why-the-vault-root-is-data)). Obsidian's preview keeps working either
way — it resolves `static/images/foo.jpg` from the vault root too — but the
site does not: a browser has no vault, so `/static/…` is the only form that
resolves. Re-add the `/` after a rename.

## Frontmatter fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | text | **yes** | |
| `description` | text | no | Shown under the title and in feeds. |
| `publishDate` | date | **yes** for posts | `YYYY-MM-DD`. |
| `lastmod` | date | no | Renders a "最后更新于" line when present. |
| `image` | text | no | Cover image, e.g. `/static/photos/x.jpg`. |
| `imageDesc` | text | no | Caption under the cover. |
| `draft` | checkbox | no | `true` hides the post: no route, no feed, no sitemap. |
| `featured` | checkbox | no | Surfaces the post in the home page's featured grid. |
| `tags` | list | no | English slugs from the taxonomy, e.g. `["Economics"]`. |
| `categories` | list | no | Free-form grouping. |

A page under `data/content/pages/` needs only `title` and `description` — it
does **not** need a `publishDate`.

## When frontmatter is wrong

The build **fails** and names the file and the field:

```
[content] data/content/blog/zzz-bad-frontmatter.md: "draft" must be a boolean, got "false". In Obsidian, set this property's type to Checkbox.
```

`npm run dev` surfaces the same message in the browser and the terminal, and
recovers by itself once the file is fixed — no restart.

This is stricter than the old Contentlayer2 setup, which *warned and skipped*
the document: a post with a mis-typed property would silently vanish from the
site with a green build. Failing loudly is the point.

## Notes

- **Dates are not rewritten.** Saving a note in Obsidian leaves untouched
  frontmatter byte-for-byte, so `git diff` after an edit shows only what you
  actually changed.
- **The feed and the lightbox read the same paths.** `/static/...` is what the
  served site, the RSS reader and the lightbox all use; there is no
  second form to keep in sync.
- **`data/.obsidian/` is gitignored** and never reaches the published template
  — it can carry plugin data, and plugins such as Livesync store credentials
  there.
