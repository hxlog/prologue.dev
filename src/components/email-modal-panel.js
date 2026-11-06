"use client";

import Modal from "./modal";
import siteMetadata from "../../data/sitemetadata";
import { useCopy } from "../lib/use-copy";

export default function EmailModalPanel({ open, onClose }) {
  const { state, copy } = useCopy();
  const email = siteMetadata.email;

  return (
    <Modal open={open} onClose={onClose} title="联系我">
      <p className="text-sm leading-6 text-muted">
        欢迎来信交流。点击下方按钮即可复制我的邮箱地址。
      </p>

      <div className="copy-field mt-4">
        <span className="min-w-0 flex-1">{email}</span>
        <button
          type="button"
          onClick={() => copy(email)}
          className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-(--duration-fast) ${
            state === "copied"
              ? "bg-accent-soft text-accent"
              : "bg-accent-strong text-on-accent hover:bg-accent-strong/90"
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
        <a href={`mailto:${email}`} className="link">
          打开邮件应用
        </a>
      </p>
    </Modal>
  );
}
