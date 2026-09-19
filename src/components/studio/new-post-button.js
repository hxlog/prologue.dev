"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createPostAction } from "../../app/studio/actions/posts";
import { IconPlus } from "./icons";

/**
 * "New post".
 *
 * Creates the post on the server and navigates to its editor — rather than
 * opening an empty editor and creating on first save — because the editor's
 * whole model is "this post already exists and I am editing its draft", and a
 * phantom post with no row would need an entire second code path through it.
 *
 * The button disables itself while the action is in flight. A double click on a
 * create button makes two posts, and the author would have to find and delete
 * one of them.
 */
export function NewPostButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function create() {
    setPending(true);
    setError(null);
    try {
      const result = await createPostAction({ title: "未命名" });
      if (result.ok) {
        router.push(`/studio/posts/${result.slug}`);
      } else {
        setError(result.message ?? "创建失败");
        setPending(false);
      }
    } catch (err) {
      setError(err?.message ?? "创建失败");
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-500">{error}</span>}
      <button
        type="button"
        onClick={create}
        disabled={pending}
        style={{ background: "var(--gradient-brand)" }}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        <IconPlus className="h-4 w-4" />
        {pending ? "创建中…" : "新建文章"}
      </button>
    </div>
  );
}
