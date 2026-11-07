"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import headerNavLinks from "../../data/headerNavLinks";

const PANEL_BASE =
  "modal-panel absolute right-0 z-50 mt-2 w-36 origin-top-right p-2 transition-[opacity,transform] duration-(--duration-fast) ease-out-expo";

/**
 * Custom mobile menu panel.
 *
 * It deliberately keeps the same visual language as the rest of the site
 * (modal-panel, motion tokens, no new colours) while providing the keyboard
 * and focus behaviour the Headless UI Menu provided: focus enters the first
 * item, arrow keys cycle, Home/End jump, Tab stays inside, Escape closes and
 * focus returns to the trigger in mobilenav.js.
 */
export default function MobileNavPanel({ open, onClose }) {
  const itemRefs = useRef([]);
  const focusItem = (element) => element?.focus({ preventScroll: true });

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => {
      focusItem(itemRefs.current[0]);
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const onKeyDown = (event) => {
    const items = itemRefs.current.filter(Boolean);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement);

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(items[(current + 1 + items.length) % items.length]);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(items[(current - 1 + items.length) % items.length]);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusItem(items[0]);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusItem(items[items.length - 1]);
      return;
    }
    if (event.key === "Tab") {
      if (event.shiftKey && current <= 0) {
        event.preventDefault();
        focusItem(items[items.length - 1]);
      } else if (!event.shiftKey && current === items.length - 1) {
        event.preventDefault();
        focusItem(items[0]);
      }
    }
  };

  const stateClass = open
    ? "pointer-events-auto scale-100 opacity-100 translate-y-0"
    : "pointer-events-none scale-95 opacity-0 -translate-y-1";

  return (
    <div
      id="mobile-nav-menu"
      role="menu"
      aria-label="Navigation"
      aria-hidden={!open}
      inert={!open}
      data-open={open ? "true" : undefined}
      onKeyDown={onKeyDown}
      className={PANEL_BASE + " " + stateClass}
    >
      {headerNavLinks.map((link, index) => (
        <Link
          key={link.title}
          href={link.href}
          prefetch={link.href === "/about" ? true : "auto"}
          role="menuitem"
          ref={(element) => {
            itemRefs.current[index] = element;
          }}
          onClick={onClose}
          className="nav-item block"
        >
          {link.title}
        </Link>
      ))}
    </div>
  );
}
