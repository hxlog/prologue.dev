"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/* The viewer is imported on intent, never statically: nothing about the
   lightbox belongs in the initial JS. The module promise is cached so the click
   that follows a pointerenter opens without a network wait. */
let viewerModule = null;
function loadViewer() {
  if (!viewerModule) {
    viewerModule = import("./lightbox-viewer")
      .then((mod) => mod.default)
      .catch((error) => {
        viewerModule = null;
        throw error;
      });
  }
  return viewerModule;
}

const IMAGE_SELECTOR = "main img.lightbox-image";

function captionOf(img) {
  return (
    img.alt ||
    img.closest("figure")?.querySelector("figcaption")?.textContent?.trim() ||
    ""
  );
}

/**
 * Opens post images (rehype-figure tags every one with .lightbox-image) in the
 * viewer.
 *
 * One delegated click listener on the document rather than a handler per image:
 * post bodies are rendered from HTML, so per-image handlers would mean walking
 * the tree after every navigation and holding a closure per <img>.
 *
 * Nothing is mounted until a click, and the viewer chunk is fetched on pointer
 * intent (pointerover/focusin/touchstart), so a reader who never opens a photo
 * downloads none of it.
 *
 * The open/close animation is the viewer's own centre zoom (see
 * lightbox-viewer.js): this file only builds the slide list and the session.
 */
export default function Lightbox() {
  const [Viewer, setViewer] = useState(null);
  const [session, setSession] = useState(null);
  const sourceRef = useRef(null);
  const restoreRef = useRef(null);

  const openAt = useCallback((img) => {
    /* Only the article the reader is actually in. React's <Activity> keeps
       navigated-away routes mounted but hidden, so a document-wide query picks
       up every article visited this session — that is how paging in one post
       used to wander into another post's images. */
    const scope = img.closest("article") || img.closest("main");
    if (!scope) return;
    const images = Array.from(scope.querySelectorAll("img.lightbox-image"));
    const index = images.indexOf(img);
    if (index === -1) return;

    const slides = images.map((element) => {
      /* Prefer what the page already downloaded (a cache hit, so the viewer
         paints on the first frame) and keep the largest srcset candidate as a
         high-resolution upgrade the viewer swaps in once it decodes. A lazy
         image below the fold has no currentSrc yet; the largest candidate is
         then the only usable source. */
      const candidates = (element.getAttribute("srcset") || "")
        .split(",")
        .map((entry) => entry.trim().split(/\s+/)[0])
        .filter(Boolean);
      const largest = candidates[candidates.length - 1] || element.src;
      return {
        src: element.currentSrc || largest,
        hires: largest,
        width: element.naturalWidth || undefined,
        height: element.naturalHeight || undefined,
        alt: element.alt || "",
        caption: captionOf(element),
      };
    });

    sourceRef.current = img;
    /* Focus goes back to the image that opened the viewer. Images are not
       focusable by default, so this uses a temporary tabindex=-1 instead of
       adding a tab stop for every picture in every article. */
    img.setAttribute("tabindex", "-1");

    const commit = (ViewerComponent) =>
      flushSync(() => {
        setViewer(() => ViewerComponent);
        setSession({ slides, index });
      });

    loadViewer()
      .then(commit)
      .catch(() => {
        img.removeAttribute("tabindex");
        sourceRef.current = null;
      });
  }, []);

  const close = useCallback(() => {
    restoreRef.current = sourceRef.current;
    sourceRef.current = null;
    setSession(null);
  }, []);

  /* Focus goes back to the image once the unmount has committed: the same
     commit lifts `inert` from the page behind the viewer, and focusing a node
     inside an inert subtree is silently ignored. An effect (unlike a rAF) is
     ordered after that commit. */
  useEffect(() => {
    if (session) return;
    const source = restoreRef.current;
    if (!source) return;
    restoreRef.current = null;
    if (!source.isConnected) return;
    /* Removing tabindex *after* focusing would make the element unfocusable
       again and the browser drops focus to <body>; drop it on blur instead. */
    source.setAttribute("tabindex", "-1");
    source.focus({ preventScroll: true });
    source.addEventListener(
      "blur",
      () => source.removeAttribute("tabindex"),
      { once: true }
    );
  }, [session]);

  useEffect(() => {
    const onClick = (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const img = target.closest("img.lightbox-image");
      if (!img || !img.closest("main")) return;
      /* A linked image keeps its link: the reader asked for the link. */
      if (img.closest("a")) return;
      /* Do not hijack a drag-selection of the caption text. */
      if (window.getSelection()?.toString()) return;
      event.preventDefault();
      openAt(img);
    };

    const onIntent = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("img.lightbox-image")) {
        loadViewer().catch(() => {});
      }
    };

    document.addEventListener("click", onClick);
    document.addEventListener("pointerover", onIntent, { passive: true });
    document.addEventListener("focusin", onIntent);
    document.addEventListener("touchstart", onIntent, { passive: true });
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("pointerover", onIntent);
      document.removeEventListener("focusin", onIntent);
      document.removeEventListener("touchstart", onIntent);
    };
  }, [openAt]);

  if (!session || !Viewer) return null;

  return (
    <Viewer
      slides={session.slides}
      startIndex={session.index}
      onClose={close}
    />
  );
}
