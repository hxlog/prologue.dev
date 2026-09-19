"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createPageAction } from "../../app/studio/actions/pages";
import { IconPlus } from "./icons";

/**
 * "New page".
 *
 * A text field rather than a bare button, because a page's slug is the URL and
 * the author knows what it should be — `about`, `now`, `uses`. A bare button
 * would have to invent one, and the editor's rename dialog would then be the
 * first thing the author saw. So the field asks for the path, and the title is
 * derived from it and edited afterwards.
 *
 * The input is normalised the same way the server normalises it (`slugify` on
 * both sides), so what the author types and what the page ends up at cannot
 * disagree — a field showing "About Me" above a page living at `/about-me` is a
 * small lie that costs a support question every time.
 */
export function NewPageButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const clean = slugPreview(slug);

  async function create(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const result = await createPageAction({ title: clean || "新页面", slug: clean });
      if (result.ok) {
        router.push(`/studio/pages/${result.slug}`);
      } else {
        setError(result.message ?? "创建失败");
        setPending(false);
      }
    } catch (err) {
      setError(err?.message ?? "创建失败");
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ background: "var(--gradient-brand)" }}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        <IconPlus className="h-4 w-4" />
        新建页面
      </button>
    );
  }

  return (
    <form onSubmit={create} className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 px-3 py-2">
        <span className="font-mono text-sm text-faint">/</span>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          autoFocus
          placeholder="about"
          aria-label="页面路径"
          className="w-32 bg-transparent font-mono text-sm text-foreground placeholder:text-faint focus:outline-none"
        />
      </div>

      {error && <span className="text-xs text-red-500">{error}</span>}

      <button
        type="submit"
        disabled={pending || !clean}
        className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "创建中…" : "创建"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setSlug("");
          setError(null);
        }}
        className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2"
      >
        取消
      </button>
    </form>
  );
}

/**
 * The path the server will derive, shown as it is typed.
 *
 * Mirrors `slugify` in src/lib/studio/revisions.js. Duplicated deliberately
 * rather than imported: that module pulls in `node:crypto` for content hashes,
 * and importing it into a client component would ship a Node polyfill into the
 * browser bundle to compute a lower-case string.
 */
function slugPreview(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
