/**
 * Overlay plumbing shared by the image lightbox and the modals.
 *
 * Both overlays need the same three things, and each one has a subtle failure
 * mode that has already shipped once in this codebase: the page must not
 * scroll behind the overlay (and locking it must not shift the layout when the
 * scrollbar disappears), Tab must stay inside the overlay, and the element that
 * opened the overlay must get focus back when it closes.
 */

const SCROLLBAR_FREE = "__overlayScrollLockFree";

/**
 * Lock document scrolling without a reflow jump.
 *
 * Hiding the page scrollbar widens the viewport by its width, so the centred
 * shell would visibly jump. The gap is measured *before* the lock and paid back
 * as padding on <html>. The lock is ref-counted: the lightbox and a modal can
 * in principle be open at the same time, and the second cleanup must not undo
 * the first one's lock.
 */
export function lockScroll() {
  const html = document.documentElement;

  if (!document[SCROLLBAR_FREE]) {
    const gap = window.innerWidth - html.clientWidth;
    document[SCROLLBAR_FREE] = {
      overflow: html.style.overflow,
      paddingRight: html.style.paddingRight,
      gap,
    };
    html.style.overflow = "hidden";
    if (gap > 0) html.style.paddingRight = `${gap}px`;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const saved = document[SCROLLBAR_FREE];
    if (!saved) return;
    document[SCROLLBAR_FREE] = null;
    html.style.overflow = saved.overflow;
    html.style.paddingRight = saved.paddingRight;
  };
}

/**
 * Mark everything behind the overlay inert, so neither the keyboard nor a
 * screen reader can reach the page under it. Returns a cleanup.
 */
export function inertBackground() {
  const targets = ["#content", "header", "footer"].flatMap((sel) =>
    Array.from(document.querySelectorAll(sel))
  );
  const touched = [];
  for (const el of targets) {
    if (!el.hasAttribute("inert")) {
      el.setAttribute("inert", "");
      touched.push(el);
    }
  }
  return () => {
    for (const el of touched) el.removeAttribute("inert");
  };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab / Shift+Tab inside `container`. Focus is moved to the first
 * focusable element when the trap is installed (unless one already has focus),
 * which is what makes every overlay keyboard-operable from the moment it opens.
 */
export function trapFocus(container) {
  const initial = document.activeElement;
  /* getClientRects(), not offsetParent: every child of a position:fixed overlay
     has offsetParent === null, so the offsetParent check found zero focusables in
     the lightbox and focus was never moved into it. */
  const items = () =>
    Array.from(container.querySelectorAll(FOCUSABLE)).filter(
      (el) => el.getClientRects().length > 0 || el === document.activeElement
    );

  const first = items()[0];
  if (first && !container.contains(document.activeElement)) first.focus();

  const onKeyDown = (event) => {
    if (event.key !== "Tab") return;
    const focusable = items();
    if (focusable.length === 0) return;
    const firstEl = focusable[0];
    const lastEl = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === firstEl) {
      event.preventDefault();
      lastEl.focus();
    } else if (!event.shiftKey && document.activeElement === lastEl) {
      event.preventDefault();
      firstEl.focus();
    }
  };

  container.addEventListener("keydown", onKeyDown);
  return () => {
    container.removeEventListener("keydown", onKeyDown);
    // The opener may have been removed by the close itself (a navigation, an
    // unmounted card); focusing a detached node silently does nothing.
    // Only restore when focus is still "ours" (on the container or nowhere):
    // the close path focuses the opener itself, and grabbing focus back here
    // would undo that.
    const active = document.activeElement;
    if (active && active !== document.body && !container.contains(active)) return;
    if (initial instanceof HTMLElement && initial.isConnected) initial.focus();
  };
}
