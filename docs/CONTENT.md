# Editing content with Obsidian

The `/data` directory can be opened as an Obsidian vault: posts, pages and the
YAML data files all live inside it, so one window reaches all of them.

This is a plain-directory arrangement. Obsidian is not required, nothing in the
build depends on it, and editing the same files in VS Code or vim works
identically.

## One-time setup

1. **Open the vault.** Obsidian → **Open folder as vault** → choose the `data`
   directory (**not** the repository root — see [Why the vault root is
   `data/`](#why-the-vault-root-is-data) below).
2. **Set the property types.** These are stored in
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

**`draft` and `featured` MUST be `checkbox`.** Typed as text, Obsidian writes
`draft: "false"` — a *string*, which is truthy in every language that matters
and which the build rejects outright rather than silently dropping the post. If
the build fails with

```
[content] data/content/blog/some-post.md: "draft" must be a boolean, got "false". In Obsidian, set this property's type to Checkbox.
```

that is this setting, and the message names the file and the fix.

### Why the vault root is `data/`

Rooting at `data/` keeps the vault small — ~70 markdown files plus a handful
of YAML — instead of the repository's 75,000-file `node_modules`. Indexing is
fast and no exclusion list is needed.

Markdown in this repo references images with a **leading slash**, which is the
form the browser and the feed readers need:

```markdown
![caption](/static/images/foo.jpg)
```

Obsidian resolves a leading `/` against the **vault root**, so that link
resolves to `<vault>/static/images/foo.jpg` — which, since the static assets
live outside the vault at `public/static/`, **does not exist**. Obsidian's
preview shows a broken image for it. This is read out of Obsidian's own code,
not guessed: `getLinkpathDest` in the shipped `app.js` strips exactly one
leading slash and then requires a **case-insensitive exact match** against a
`TFile.path`, with an explicit `if (linkpath.startsWith("/")) return []` on the
failure path — no basename fallback, no suffix search, so "close enough" never
resolves.

The trade-off is deliberate. The alternative — moving the assets under `data/`
and symlinking `public/static` at them so one vault reaches everything — makes
the site un-buildable on Vercel, which refuses the static copy step with:

```
Error: Cannot copy '../data/static' to a subdirectory of itself, '../data/static'.
```

Portability of the deployed site wins over image previews inside the editor.
Write and edit text in Obsidian; check how an image looks on the running site.

## What lives where

| Path | What it is |
|---|---|
| `data/content/blog/*.md` | Posts. Add a file here and it appears on the site. |
| `data/content/pages/*.md` | Standalone pages, e.g. `about.md` → `/about`. |
| `data/microblog.yaml` | Microblog entries. |
| `data/links.yaml` | Friend links. |
| `data/sitemetadata.js` | Site title, author, URL, Giscus and analytics IDs. |
| `data/tagLabels.js` | Tag slugs and the labels the UI renders for them. |
| `data/headerNavLinks.js` | Navigation bar links. |
| `public/static/images/` | Illustrations referenced from posts. |
| `public/static/photos/` | Cover images. |
| `public/static/avatars/` | Friend-link avatars. |
| `public/static/favicons/` | Site icon, author avatar, default cover. |

The four `.js` files are JavaScript, not markdown, because client components
import them directly and a browser cannot import markdown. Obsidian shows them
under *Show all file types* but cannot open or edit them — edit them in a code
editor.

## The YAML data files

`data/microblog.yaml` is a list of entries, each with a `date` and a `content`
string. Paragraphs are separated by a blank line; images are ordinary markdown
inside the content:

```yaml
- date: 2026-03-14
  content: |
    正文第一段。

    ![配图说明](/static/photos/a.jpg)
```

Entry anchors (`/microblog#mb-20260314-23`) and RSS `<guid>`s are **derived**
from the date plus the entry's position in the list, zero-padded: `mb-` +
`YYYYMMDD` + `-` + array index. Inserting an entry in the *middle* renumbers
every later entry and silently breaks both the anchors and every feed reader's
unread state. **Append new entries at the end**, or accept that the later
anchors change.

`data/links.yaml` is a list of friend links, each with `name`, `blog_url` and
`avatar`. The avatar may be a local path under `public/static/avatars/` or a
full URL.

## Adding an image

1. Put the file under `public/static/images/`.
2. Reference it in the note with a leading slash:

   ```markdown
   ![描述文字](/static/images/<file>)
   ```

   The description in the square brackets becomes the lightbox caption.

The file is served directly at `/static/images/<file>`, so the same path works
in the page, the lightbox and the RSS feed — there is no second form to keep in
sync. The one place the path does not resolve is Obsidian's own preview, for
the reason in [Why the vault root is `data/`](#why-the-vault-root-is-data).

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
- **`data/.obsidian/` is gitignored** and never reaches the published template
  — it can carry plugin data, and plugins such as Livesync store credentials
  there.
