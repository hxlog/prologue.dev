'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';

function findImageElement(target) {
  let el = target;
  while (el && el !== document.body) {
    if (
      el.nodeType === 1 &&
      ((el.tagName === 'IMG' && typeof el.className === 'string' && el.className.includes('lightbox-image')) ||
        (typeof el.className === 'string' && el.className.includes('lightbox-image') && el.querySelector && el.querySelector('img')))
    ) {
      return el.tagName === 'IMG' ? el : el.querySelector('img');
    }
    el = el.parentElement;
  }
  return null;
}

function getCaption(img) {
  let figure = img.parentElement;
  while (figure && figure.tagName !== 'FIGURE') {
    figure = figure.parentElement;
  }
  if (figure) {
    const caption = figure.querySelector('figcaption');
    if (caption && caption.textContent.trim()) return caption.textContent.trim();
  }
  return img.alt || '';
}

export default function ImageLightbox() {
  const [open, setOpen] = useState(false);
  const [slides, setSlides] = useState([]);
  const [index, setIndex] = useState(0);
  const imagesRef = useRef([]);
  const pathname = usePathname();

  useEffect(() => {
    // Scope the scan to <main>: under Cache Components React's <Activity> may
    // keep a previously visited route mounted but hidden, and a document-wide
    // query would put those off-screen images into the slide list — the swipe
    // order would include photos the reader cannot see, and clicking the
    // first visible one would open at the wrong index.
    const main = document.querySelector("main") ?? document.body;

    const refreshImages = () => {
      imagesRef.current = Array.from(
        main.querySelectorAll("img.lightbox-image")
      );
    };

    refreshImages();

    const rafId = requestAnimationFrame(refreshImages);
    const timerId = window.setTimeout(refreshImages, 120);

    const observer = new MutationObserver(() => refreshImages());
    observer.observe(main, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
      observer.disconnect();
    };
  }, [pathname]);

  useEffect(() => {
    const handleClick = (e) => {
      const img = findImageElement(e.target);
      if (img) {
        const main = document.querySelector("main") ?? document.body;
        const images = Array.from(
          main.querySelectorAll("img.lightbox-image")
        );
        imagesRef.current = images;
        const slides = images.map((el) => ({
          src: el.src,
          alt: el.alt,
          caption: getCaption(el),
        }));
        const idx = images.findIndex((el) => el === img);
        if (idx !== -1) {
          setSlides(slides);
          setIndex(idx);
          setOpen(true);
        }
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return (
    <Lightbox
      open={open}
      close={() => setOpen(false)}
      slides={slides}
      index={index}
      on={{ view: ({ index }) => setIndex(index) }}
      plugins={[Zoom]}
      zoom={{
        maxZoomPixelRatio: 3.5,
        zoomInMultiplier: 1.65,
        doubleTapDelay: 300,
        doubleClickDelay: 300,
        wheelZoomDistanceFactor: 90,
        pinchZoomDistanceFactor: 120,
        scrollToZoom: true,
      }}
      carousel={{
        padding: 0,
        spacing: 8,
      }}
      render={{
        slideFooter: ({ slide }) =>
          slide.caption ? (
            <div className="yarl__slide_footer">
              <p className="yarl__caption_text">{slide.caption}</p>
            </div>
          ) : null,
      }}
    />
  );
}
