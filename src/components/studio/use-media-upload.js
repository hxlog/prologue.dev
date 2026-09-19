"use client";

import { useCallback, useState } from "react";

import { beginUploadAction, commitUploadAction } from "../../app/studio/actions/media";

/**
 * Upload one file, in the three steps the design requires.
 *
 * ## Why the bytes do not go through the server action
 *
 * `beginUploadAction` returns a presigned URL, and the PUT below goes straight
 * from this tab to Vercel Blob. Routing 12 MB through a function would hit the
 * body limit and pay for every byte twice; the presigned URL is the whole reason
 * the transfer is browser → storage.
 *
 * The server still decides the pathname, the allowed type and the size ceiling —
 * they are baked into the signature, so a client that edits the request is
 * refused at storage rather than caught afterwards.
 *
 * ## The size and dimensions are read here, before the upload
 *
 * `createImageBitmap` decodes the file once to get its real width and height,
 * which the grid uses to reserve the right box and avoid a reflow as thumbnails
 * land. It also means the declared size sent to `beginUpload` is the actual byte
 * count rather than a guess, so an oversized file is refused before any of it
 * crosses the network.
 *
 * A decode failure is not fatal: the upload proceeds with `null` dimensions,
 * because refusing to accept an image we cannot measure would be worse than a
 * grid cell that sizes itself from the image.
 */
export function useMediaUpload() {
  const [uploads, setUploads] = useState([]);

  const upload = useCallback(async (file) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setUploads((all) => [...all, { id, name: file.name, status: "preparing" }]);

    const patch = (changes) =>
      setUploads((all) => all.map((u) => (u.id === id ? { ...u, ...changes } : u)));

    try {
      const [ticket, dims] = await Promise.all([
        beginUploadAction({
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
        measure(file),
      ]);

      if (!ticket?.ok) {
        patch({ status: "failed", error: ticket?.reason ?? "begin_failed" });
        return null;
      }

      patch({ status: "uploading" });

      const res = await fetch(ticket.presignedUrl, {
        method: "PUT",
        body: file,
        headers: { "content-type": file.type },
      });
      if (!res.ok) {
        patch({ status: "failed", error: `upload_${res.status}` });
        return null;
      }

      patch({ status: "committing" });

      const saved = await commitUploadAction({
        pathname: ticket.pathname,
        originalName: file.name,
        contentType: file.type,
        size: file.size,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        alt: "",
      });

      if (!saved?.ok) {
        patch({ status: "failed", error: saved?.reason ?? "commit_failed" });
        return null;
      }

      patch({ status: "done", media: saved.media });
      setUploads((all) => all.filter((u) => u.id !== id));
      return saved.media;
    } catch (err) {
      patch({ status: "failed", error: err?.message ?? "failed" });
      return null;
    }
  }, []);

  return { upload, uploads };
}

async function measure(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return dims;
  } catch {
    return null;
  }
}
