"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { inertBackground, lockScroll, trapFocus } from "../lib/overlay";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.35;
const DOUBLE_CLICK_ZOOM = 2.4;

/* Morph: a FLIP handoff from the clicked thumbnail's rect to the laid-out
   viewer image, on the Web Animations API. This replaced View Transitions after
   measuring the capture cost on an image-heavy post: startViewTransition() took
   180-250 ms before it would even call the update callback there (the browser
   snapshots the whole page), which is exactly the "opens slowly" report. FLIP
   starts in the same frame as the click; the source rect is captured at click
   time, so no snapshot and no named elements are involved. */
const MORPH_MS = 300;
const MORPH_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function clampOffset(next, zoomValue, img) {
  if (zoomValue <= MIN_ZOOM || !img) return { x: 0, y: 0 };
  const maxX = (img.clientWidth * (zoomValue - 1)) / 2;
  const maxY = (img.clientHeight * (zoomValue - 1)) / 2;
  return {
    x: clamp(next.x, -maxX, maxX),
    y: clamp(next.y, -maxY, maxY),
  };
}

/**
 * The image viewer. Mounted only while the lightbox is open (the controller
 * renders it on demand and warms the chunk on pointer intent), so it costs
 * nothing on first load.
 *
 * Deliberately not a <dialog>: the open/close animation is driven by the View
 * Transitions API, and a top-layer dialog is a separate rendering context that
 * does not always participate in a same-document transition. Everything the
 * dialog gave us is here instead — focus trap, inert background, Esc, scroll
 * lock — in src/lib/overlay.js.
 *
 * Zoom model: one transform on the figure (translate + scale), offset clamped
 * to the scaled bounds so the image cannot be dragged out of the viewport. The
 * bitmap is the already-optimised URL the page loaded (currentSrc), so opening
 * is a cache hit rather than a second download.
 */
export default function LightboxViewer({ slides, startIndex, morph, origin, onClose }) {
  const [index, setIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  /* Both are derived, not mirrored: the displayed URL is "the cached one, then
     the largest srcset candidate once it decodes", and "loaded" means "the
     bitmap currently on screen has fired load". Storing either as state that an
     effect syncs would add a cascading render on every arrow key. */
  const [upgraded, setUpgraded] = useState(null);
  const [loadedSrc, setLoadedSrc] = useState(null);

  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const pinchRef = useRef(null);
  const pointersRef = useRef(new Map());
  const closingRef = useRef(false);

  const total = slides.length;
  const slide = slides[index];
  /* Opening paints from the URL the page already downloaded (a cache hit);
     zooming to 4× still gets the real file once the upgrade decodes. */
  const src = upgraded && upgraded.index === index ? upgraded.src : slide?.src;
  const loaded = loadedSrc === src;

  const resetView = useCallback(() => {
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
  }, []);

  const go = useCallback(
    (delta) => {
      if (total < 2) return;
      setIndex((current) => (current + delta + total) % total);
      resetView();
    },
    [resetView, total]
  );

  /* The morph itself. Runs before the first paint so the viewer never shows up
     at its final size and then jumps back to the thumbnail. The source image's
     intrinsic size is passed in as width/height, so the target box exists even
     before the bitmap decodes. */
  useLayoutEffect(() => {
    if (!morph || !origin) return;
    const img = imageRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height || !origin.width || !origin.height) return;
    const dx = origin.left + origin.width / 2 - (rect.left + rect.width / 2);
    const dy = origin.top + origin.height / 2 - (rect.top + rect.height / 2);
    const scale = origin.width / rect.width;
    img.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.35 },
        { transform: "none", opacity: 1 },
      ],
      { duration: MORPH_MS, easing: MORPH_EASE }
    );
  }, [morph, origin]);

  /* Close is immediate on purpose. A reverse morph has to keep the viewer
     mounted until an animation finishes, which makes Esc / the close button feel
     laggy on a throttled frame (measured: up to a second to react); unmounting
     synchronously is what every image viewer does and can never stall. */
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    onClose();
  }, [onClose]);

  /* Decode the high-resolution candidate in the background and swap it in. The
     setter runs from an image callback, never synchronously in the effect. */
  useEffect(() => {
    const target = slides[index];
    if (!target?.hires || target.hires === target.src) return undefined;
    let cancelled = false;
    const upgrade = new Image();
    upgrade.src = target.hires;
    upgrade.onload = () => {
      if (!cancelled) setUpgraded({ index, src: target.hires });
    };
    return () => {
      cancelled = true;
    };
  }, [index, slides]);

  const zoomTo = useCallback((next) => {
    const value = clamp(next, MIN_ZOOM, MAX_ZOOM);
    setZoom(value);
    setOffset((current) => clampOffset(current, value, imageRef.current));
  }, []);

  const zoomBy = useCallback(
    (factor) => setZoom((current) => clamp(current * factor, MIN_ZOOM, MAX_ZOOM)),
    []
  );

  /* Scroll lock, inert background, focus trap — installed once, one frame
     after mount. All three touch the rest of the document (`inert` on a
     70 KB article invalidates its whole style/layout tree), and running them
     inside the open handler put that work between the click and the first
     painted frame of the viewer. The background is already behind the scrim, so
     a frame of delay is invisible. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let undo = null;
    const frame = requestAnimationFrame(() => {
      const unlock = lockScroll();
      const uninert = inertBackground();
      const untrap = trapFocus(root);
      undo = () => {
        untrap();
        uninert();
        unlock();
      };
    });
    return () => {
      cancelAnimationFrame(frame);
      undo?.();
    };
  }, []);

  /* Keyboard: the whole viewer is driveable without a pointer. */
  useEffect(() => {
    const onKeyDown = (event) => {
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          requestClose();
          break;
        case "ArrowLeft":
          event.preventDefault();
          go(-1);
          break;
        case "ArrowRight":
          event.preventDefault();
          go(1);
          break;
        case "+":
        case "=":
          event.preventDefault();
          zoomBy(ZOOM_STEP);
          break;
        case "-":
        case "_":
          event.preventDefault();
          zoomBy(1 / ZOOM_STEP);
          break;
        case "0":
          event.preventDefault();
          resetView();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, requestClose, resetView, zoomBy]);

  /* Wheel zoom needs a non-passive listener to call preventDefault. */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  /* Warm the neighbouring slides so a next/prev is a cache hit. */
  useEffect(() => {
    for (const delta of [-1, 1]) {
      const neighbour = slides[(index + delta + total) % total];
      if (neighbour && neighbour.src !== slide?.src) {
        const preload = new Image();
        preload.src = neighbour.src;
      }
    }
  }, [index, slide, slides, total]);

  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        zoom,
      };
      dragRef.current = null;
      return;
    }
    if (zoom > MIN_ZOOM) {
      dragRef.current = {
        x: event.clientX,
        y: event.clientY,
        offset,
        pointerId: event.pointerId,
      };
    }
  };

  const onPointerMove = (event) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.distance > 0) {
        const next = clamp((pinch.zoom * distance) / pinch.distance, MIN_ZOOM, MAX_ZOOM);
        setZoom(next);
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    const next = {
      x: drag.offset.x + (event.clientX - drag.x),
      y: drag.offset.y + (event.clientY - drag.y),
    };
    setOffset(clampOffset(next, zoom, imageRef.current));
  };

  const endPointer = (event) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const toggleZoom = (event) => {
    if (event.target instanceof Element && event.target.closest("button")) return;
    zoomTo(zoom > MIN_ZOOM ? MIN_ZOOM : DOUBLE_CLICK_ZOOM);
  };

  const closeOnBackdrop = (event) => {
    const target = event.target;
    if (target === rootRef.current || target === stageRef.current) requestClose();
  };

  if (!slide) return null;

  return (
    <div
      ref={rootRef}
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`图片查看器：第 ${index + 1} 张，共 ${total} 张`}
      onClick={closeOnBackdrop}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onDoubleClick={toggleZoom}
    >
      <button
        type="button"
        className="lightbox-close"
        aria-label="关闭"
        onClick={requestClose}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4" fill="currentColor">
          <path d="M4.3 4.3a1 1 0 0 1 1.4 0L10 8.6l4.3-4.3a1 1 0 1 1 1.4 1.4L11.4 10l4.3 4.3a1 1 0 0 1-1.4 1.4L10 11.4l-4.3 4.3a1 1 0 0 1-1.4-1.4L8.6 10 4.3 5.7a1 1 0 0 1 0-1.4Z" />
        </svg>
      </button>

      <div ref={stageRef} className="lightbox-stage">
        {total > 1 ? (
          <button
            type="button"
            className="lightbox-nav lightbox-nav--prev"
            aria-label="上一张"
            onClick={(event) => {
              event.stopPropagation();
              go(-1);
            }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5" fill="currentColor">
              <path d="M12.7 4.3a1 1 0 0 1 0 1.4L8.4 10l4.3 4.3a1 1 0 0 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0Z" />
            </svg>
          </button>
        ) : null}

        <figure
          className="lightbox-figure"
          data-morph={morph ? "true" : undefined}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
            cursor: zoom > MIN_ZOOM ? "grab" : "zoom-in",
          }}
        >
          {/* A plain <img>, not next/image: the point is to paint the exact
              URL the page already downloaded (currentSrc). Routing it back
              through the optimizer would request a different width and cost a
              second round trip on the one action that has to feel instant. */}
          {/* width/height are the source bitmap's intrinsic size: they reserve
              the right box before the bitmap decodes, which is what lets the
              morph measure a real target rect on the same frame as the click. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={src}
            alt={slide.alt}
            width={slide.width || undefined}
            height={slide.height || undefined}
            decoding="async"
            draggable="false"
            onLoad={() => setLoadedSrc(src)}
            data-loaded={loaded ? "true" : undefined}
          />
        </figure>

        {total > 1 ? (
          <button
            type="button"
            className="lightbox-nav lightbox-nav--next"
            aria-label="下一张"
            onClick={(event) => {
              event.stopPropagation();
              go(1);
            }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5" fill="currentColor">
              <path d="M7.3 4.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4-1.4L11.6 10 7.3 5.7a1 1 0 0 1 0-1.4Z" />
            </svg>
          </button>
        ) : null}
      </div>

      <div className="lightbox-bar">
        <span className="lightbox-counter" aria-hidden="true">
          {index + 1} / {total}
        </span>
        <button
          type="button"
          className="lightbox-tool"
          aria-label="缩小"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4" fill="currentColor">
            <path d="M4 9a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Z" />
          </svg>
        </button>
        <button
          type="button"
          className="lightbox-tool"
          aria-label="放大"
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4" fill="currentColor">
            <path d="M9 4a1 1 0 0 1 1 1v3h3a1 1 0 1 1 0 2h-3v3a1 1 0 1 1-2 0v-3H5a1 1 0 1 1 0-2h3V5a1 1 0 0 1 1-1Z" />
          </svg>
        </button>
        <button
          type="button"
          className="lightbox-tool"
          aria-label="原始大小"
          onClick={resetView}
          disabled={zoom === MIN_ZOOM}
        >
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M7 4H4v3M13 4h3v3M7 16H4v-3M13 16h3v-3" />
          </svg>
        </button>
      </div>

      {slide.caption ? <p className="lightbox-caption">{slide.caption}</p> : null}
    </div>
  );
}
