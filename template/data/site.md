---
title: My Prologue Blog
author: Your Name
authorDesc: Write a short bio here
publishName: Prologue
headerTitle: What's past is prologue
description: A content-first blog built on Next.js App Router and Markdown.
language: en-US
keywords:
  - blog
  - nextjs
  - markdown
siteUrl: https://prologue-blog-demo.prologue.dev/
siteRepo: my-blog
repoid: REPLACE_WITH_GISCUS_REPO_ID
categoryid: REPLACE_WITH_GISCUS_CATEGORY_ID
favicon: /favicon.svg
avatar: /static/favicons/avatar-template.svg
cover: /static/favicons/cover-template.svg
email: hello@example.com
github: your-github-id
umamiScriptUrl: https://REPLACE_WITH_YOUR_UMAMI_HOST/script.js
umamiRecorderUrl: https://REPLACE_WITH_YOUR_UMAMI_HOST/recorder.js
umamiWebsiteId: REPLACE_WITH_UMAMI_WEBSITE_ID
umamiDomains: example.com
---

<!--
Site configuration -- this is the file that makes the blog yours. Edit the
properties above in Obsidian's Properties panel (or in any editor), then run
`npm run site-data` to regenerate `data/sitemetadata.js`, which is what the
site actually imports. `npm run dev` and `npm run build` do that for you.

The generated file is committed, so a clone builds without this step having
been run. Nothing below the properties is read; it is a place to keep notes.

Property types, when setting them by hand: `keywords` is a LIST, everything
else is TEXT.

Giscus comments: create Discussions on your repo, install the Giscus app, then
copy the two IDs from https://giscus.app into `repoid` and `categoryid`. Leave
them blank to disable comments.

Analytics: `umami*` are the four fields of one self-hosted Umami block.
Delete all four to ship no analytics; a half-filled block fails the build
rather than silently shipping a broken script tag.
-->

## Notes

Blog title, author, canonical URL, feed and Open Graph metadata, Giscus
comment IDs and self-hosted Umami analytics all live here. The starter's
avatar and cover are the SVGs under `data/static/favicons/` -- replace them,
and change the paths above if your files have different names.
