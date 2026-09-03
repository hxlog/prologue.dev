"use client";

import { useState } from "react";
import Modal from "./modal";
import siteMetadata from "../../data/sitemetadata";
import { useCopy } from "../lib/use-copy";

/**
 * Footer email modal (replaces the raw mailto link). Shows the address in a
 * copy field with a copy button; if the Clipboard API is denied, the address
 * stays visible/selectable and the user is prompted to copy it manually.
 */
export default function EmailModal() {
  const [open, setOpen] = useState(false);
  const { state, copy } = useCopy();
  const email = siteMetadata.email;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Email"
        className="rounded-full p-1 text-faint transition-all duration-200 hover:scale-105 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <svg
          className="h-6 w-6 fill-current"
          fill="currentColor"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M2.003 5.884 10 9.882l7.997-3.998A2 2 0 0 0 16 4H4a2 2 0 0 0-1.997 1.884z"
          />
          <path
            d="m18 8.118-8 4-8-4V14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.118z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="联系我">
        <p className="text-sm leading-6 text-muted">
          欢迎来信交流。点击下方按钮即可复制我的邮箱地址。
        </p>

        <div className="copy-field mt-4">
          <span className="min-w-0 flex-1">{email}</span>
          <button
            type="button"
            onClick={() => copy(email)}
            className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
              state === "copied"
                ? "bg-accent-soft text-accent"
                : "bg-accent text-white hover:bg-accent-strong"
            }`}
          >
            {state === "copied" ? "已复制 ✓" : "复制"}
          </button>
        </div>

        {state === "error" && (
          <p className="mt-2 text-xs text-secondary">
            浏览器拒绝了自动复制，请长按/选中上方邮箱手动复制。
          </p>
        )}

        <p className="mt-4 text-xs text-faint">
          或者{" "}
          <a
            href={`mailto:${email}`}
            className="text-accent underline decoration-accent/40 underline-offset-2 transition-colors hover:text-accent-strong"
          >
            打开邮件应用
          </a>
        </p>
      </Modal>
    </>
  );
}
