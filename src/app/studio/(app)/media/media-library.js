"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  deleteMediaAction,
  listMediaAction,
  updateMediaAction,
} from "../../actions/media";
import { mediaUrl } from "../../../../lib/media/paths";
import { useMediaUpload } from "../../../../components/studio/use-media-upload";
import { IconPlus, IconSearch } from "../../../../components/studio/icons";

/**
 * The library.
 *
 * ## The detail panel is inline, not a modal
 *
 * An image library is skimmed, and a modal is a mode: opening one to read an alt
 * text hides the grid you were skimming and costs a click to get back. So the
 * grid is on the left and the selected object's fields are on the right, and
 * clicking a thumbnail swaps what the panel is about without moving anything.
 * On a phone the panel stacks under the grid, which is the same information in
 * one column.
 *
 * ## Alt text is treated as the primary field, not an extra
 *
 * Every image inserted into a post carries alt text into the markdown, and this
 * is where it comes from. The panel puts it first, shows the character count,
 * and warns — does not block — when it is empty. Blocking would be wrong (a
 * decorative image is legitimately `""`) and silent omission would be worse:
 * 179 images shipped without alt text once already, and nothing said so.
 */
export function MediaLibrary({ initial, total, configured }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [selected, setSelected] = useState(initial[0] ?? null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [copied, setCopied] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);
  const { upload, uploads } = useMediaUpload();

  async function run(fn) {
    try {
      return await fn();
    } catch (err) {
      setError(err?.message ?? "操作失败");
      return null;
    }
  }

  async function refresh(term = search) {
    setLoading(true);
    try {
      const data = await listMediaAction({ query: term, limit: 120 });
      const next = data?.media ?? [];
      setItems(next);
      setSelected((current) =>
        next.find((m) => m.id === current?.id) ?? next[0] ?? null
      );
    } catch (err) {
      setError(err?.message ?? "读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleFiles(files) {
    const incoming = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!incoming.length) {
      setError("只支持图片文件。");
      return;
    }
    setError(null);

    const added = [];
    for (const file of incoming) {
      const media = await upload(file);
      if (media) added.push(media);
    }

    if (added.length) {
      // Prepended rather than refetched: the upload already returned the rows,
      // and a full reload would drop the selection the author just made.
      setItems((all) => [...added, ...all]);
      setSelected(added[0]);
      setNotice(`已上传 ${added.length} 个文件。`);
      router.refresh();
    }
  }

  async function saveField(changes) {
    if (!selected) return;
    const result = await run(() => updateMediaAction(selected.id, changes));
    if (result?.ok) {
      setItems((all) => all.map((m) => (m.id === result.media.id ? result.media : m)));
      setSelected(result.media);
      setNotice("已保存。");
    } else if (result) {
      setError("保存失败。");
    }
  }

  async function remove(media, { force = false } = {}) {
    const result = await run(() => deleteMediaAction(media.id, force));
    if (!result) return;

    if (result.ok) {
      setItems((all) => all.filter((m) => m.id !== media.id));
      setSelected((current) => (current?.id === media.id ? null : current));
      setNotice("已删除。");
      router.refresh();
      return;
    }

    if (result.reason === "in_use") {
      // A refusal is information, not a dead end. The counts are shown, and
      // then the author is offered the override — because the two cases are
      // genuinely different and only they can tell them apart:
      //
      //   - the file is referenced by a post they intend to keep, in which
      //     case they should go remove the reference, and
      //   - the file is referenced by a post they deleted or by a draft that
      //     will never ship, in which case it is unreachable and they want it
      //     gone now.
      //
      // The server will not do this without `force`, and the button is a
      // second, explicit act rather than the same one repeated.
      //
      // Every count `usageFor` returns has to appear here. A number the server
      // refuses on but the dialog omits produces the worst of both: a refusal
      // with no reason shown, which reads as a bug rather than as information.
      // `covers` was exactly that — the check counted a cover image and the
      // message did not, so the author was told "in use by ." and blocked.
      const where = [
        result.posts ? `${result.posts} 篇文章` : null,
        result.pages ? `${result.pages} 个页面` : null,
        result.entries ? `${result.entries} 条集合条目` : null,
        result.covers ? `${result.covers} 篇文章的封面` : null,
      ]
        .filter(Boolean)
        .join("、");

      setError({
        message: `这个文件还在被 ${where} 使用。删掉图片会让那些页面出现裂图。`,
        force: { media, where },
      });
      return;
    }

    setError("删除失败。");
  }

  async function forceRemove(media, where) {
    // The author has been shown where it is used and has chosen anyway. The
    // decision is theirs; re-asking would just be the same refusal twice.
    const result = await run(() => deleteMediaAction(media.id, true));
    if (!result) return;
    if (!result.ok) {
      setError("删除失败。");
      return;
    }
    setItems((all) => all.filter((m) => m.id !== media.id));
    setSelected((current) => (current?.id === media.id ? null : current));
    setError(null);
    setNotice(`已删除，${where} 中的引用会变成裂图。`);
    router.refresh();
  }

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("复制失败，请手动选择文本。");
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <p>{typeof error === "string" ? error : error.message}</p>
          {typeof error === "object" && error?.force && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => forceRemove(error.force.media, error.force.where)}
                className="rounded-lg border border-danger/40 px-2.5 py-1 text-xs text-danger transition-colors hover:bg-danger-soft"
              >
                我知道，仍然删除
              </button>
              <span className="text-[11px] text-muted">
                先在这些内容里移除引用，通常才是你想要的。
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setError(null)}
            className="mt-2 text-xs underline"
          >
            知道了
          </button>
        </div>
      )}
      {notice && (
        <p className="rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent">
          {notice}
        </p>
      )}

      {!configured ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-8 text-center">
          <p className="text-sm text-muted">未配置 Blob 存储</p>
          <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-faint">
            在 <span className="font-mono">.env.local</span> 中填入{" "}
            <span className="font-mono">BLOB_READ_WRITE_TOKEN</span> 与{" "}
            <span className="font-mono">BLOB_STORE_ID</span>，重启开发服务器后即可上传。
            上传的图片存放在私有存储中，通过站内的{" "}
            <span className="font-mono">/api/img</span> 代理读取。
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1.5 sm:max-w-xs">
            <IconSearch className="h-3.5 w-3.5 shrink-0 text-faint" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && refresh()}
              placeholder="按文件名、alt 或说明搜索"
              aria-label="搜索媒体库"
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-faint focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium btn-brand"
            style={{ background: "var(--gradient-brand)" }}
          >
            <IconPlus className="h-3.5 w-3.5" />
            上传
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {loading && <span className="text-[11px] text-faint">读取中…</span>}
        </div>
      )}

      {uploads.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-border bg-surface px-3 py-2">
          {uploads.map((u) => (
            <li key={u.id} className="text-[11px] text-muted">
              {u.name} ·{" "}
              {u.status === "failed"
                ? `失败：${describe(u.error)}`
                : u.status === "uploading"
                  ? "上传中…"
                  : u.status === "committing"
                    ? "写入…"
                    : "准备…"}
            </li>
          ))}
        </ul>
      )}

      {configured && (
        <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={`rounded-xl border border-dashed p-3 transition-colors ${
              dragOver ? "border-accent bg-accent-soft/40" : "border-border bg-surface"
            }`}
          >
            {items.length === 0 ? (
              <p className="py-12 text-center text-xs text-faint">
                {search ? "没有匹配的文件。" : "媒体库还是空的。拖入图片，或点击上传。"}
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {items.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(m)}
                      aria-pressed={selected?.id === m.id}
                      title={m.original_name ?? m.pathname}
                      className={`group block w-full overflow-hidden rounded-lg border text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                        selected?.id === m.id
                          ? "border-accent ring-1 ring-accent/40"
                          : "border-border hover:border-accent"
                      }`}
                    >
                      {/*
                        A plain <img> on purpose. These are admin thumbnails
                        fetched through /api/img without the optimiser, whose
                        request carries no cookie — which would 404 for anything
                        not referenced by a published document.
                      */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={mediaUrl(m.pathname)}
                        alt={m.alt ?? ""}
                        loading="lazy"
                        className="aspect-4/3 w-full bg-surface-2 object-cover"
                      />
                      <span className="block truncate px-2 py-1 text-[10px] text-faint group-hover:text-accent">
                        {m.original_name || m.pathname.split("/").pop()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selected && (
            <Detail
              key={selected.id}
              media={selected}
              copied={copied}
              onSave={saveField}
              onDelete={() => remove(selected)}
              onCopy={copy}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The selected object.
 *
 * `key={selected.id}` on the parent is what makes this remount per object rather
 * than reconcile across two — without it the alt input would carry the previous
 * image's text into the next one for a frame, and an author who typed and
 * clicked quickly would save the wrong string onto the wrong file.
 */
function Detail({ media, copied, onSave, onDelete, onCopy }) {
  const [alt, setAlt] = useState(media.alt ?? "");
  const [caption, setCaption] = useState(media.caption ?? "");

  const url = mediaUrl(media.pathname);
  const dirty = alt !== (media.alt ?? "") || caption !== (media.caption ?? "");

  return (
    <aside className="rounded-xl border border-border bg-surface lg:sticky lg:top-4 lg:self-start">
      <div className="border-b border-border bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={media.alt ?? ""}
          className="mx-auto max-h-64 w-full object-contain"
        />
      </div>

      <div className="space-y-3 p-3">
        <div>
          <p className="break-all text-xs text-foreground">
            {media.original_name || media.pathname.split("/").pop()}
          </p>
          <p className="mt-1 font-mono text-[10px] break-all text-faint">
            {media.pathname}
          </p>
        </div>

        <Field label="Alt 文本" hint={alt.length ? `${alt.length} 字` : "未填写"}>
          <textarea
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            rows={2}
            className={input}
            placeholder="图片内容的替代文字，会写进正文的 markdown"
          />
        </Field>

        <Field label="说明" hint="可选">
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className={input}
            placeholder="图片下方的说明文字"
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!dirty}
            onClick={() => onSave({ alt, caption })}
            className="rounded-lg px-3 py-1.5 text-xs font-medium btn-brand disabled:opacity-40"
            style={{ background: "var(--gradient-brand)" }}
          >
            保存
          </button>
          <button
            type="button"
            onClick={() =>
              onCopy(`![${alt}](${url})`, "markdown")
            }
            className={ghost}
          >
            {copied === "markdown" ? "已复制" : "复制 Markdown"}
          </button>
          <button type="button" onClick={() => onCopy(url, "url")} className={ghost}>
            {copied === "url" ? "已复制" : "复制链接"}
          </button>
        </div>

        <p className="text-[10px] text-faint">
          {formatSize(media.size_bytes)}
          {media.width && media.height ? ` · ${media.width}×${media.height}` : ""}
          {media.created_at
            ? ` · ${new Date(media.created_at).toISOString().slice(0, 10)}`
            : ""}
        </p>

        <button
          type="button"
          onClick={onDelete}
          className="w-full rounded-lg border border-danger/40 px-3 py-1.5 text-xs text-danger transition-colors hover:bg-danger-soft"
        >
          删除
        </button>

        <p className="text-[10px] leading-5 text-faint">
          删除会先检查引用。被已发布内容引用的图片无法直接删除，避免页面上留下裂图。
        </p>
      </div>
    </aside>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted">{label}</span>
        {hint && <span className="text-[10px] text-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function describe(reason) {
  switch (reason) {
    case "unsupported_type":
      return "不支持的格式";
    case "too_large":
      return "文件过大（上限 25 MB）";
    case "not_uploaded":
      return "上传未完成";
    case "invalid_pathname":
      return "路径不合法";
    default:
      return reason || "失败";
  }
}

function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "大小未知";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground " +
  "placeholder:text-faint transition-colors focus:border-accent focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/40";

const ghost =
  "rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors " +
  "hover:bg-surface-2 hover:text-accent";
