---
title: Tags
description: Tag slugs and the labels the UI renders for them
---

<!--
Tag display labels. One row per tag: `slug` is what appears in post
frontmatter and in /tags/<slug> URLs, `label` is what the UI renders. Edit the
table in Obsidian's table editor, then run `npm run site-data` (or restart
`npm run dev`) to regenerate `data/tagLabels.js`.

The starter ships labels matching the slugs. Translate the `label` column into
whatever language you write in -- the two starter tags (`starter`, `hello`)
are used by the posts under `data/content/blog/`, so keep or retag them
together with those posts.

Slugs stay English and ASCII on purpose: they are the stable part of a tag
URL, and they appear raw in feeds and analytics. Only the labels are
translated. A tag with no row here falls back to showing its slug.

The generated file `data/tagLabels.js` is committed, so a clone builds without
running the generator first.
-->

| slug | label |
| --- | --- |
| Economics | Economics |
| Finance | Finance |
| Quant | Data Science |
| Crypto | Crypto |
| AI | AI |
| Sociology | Sociology |
| Capitalism | Capitalism |
| Education | Education |
| Inequality | Inequality |
| Politics | Politics |
| Philosophy | Philosophy |
| Technology | Technology |
| Meta | Notes |
| Translations | Translations |
| Gender | Gender |
| starter | Starter |
| hello | Hello |
