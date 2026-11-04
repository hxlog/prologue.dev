"use client";

import { ThemeProvider } from "next-themes";

/**
 * Client providers for the root layout.
 *
 * This used to wrap the tree in framer-motion's <MotionConfig reducedMotion="user">,
 * which pulled the whole animation library into the root chunk of every route
 * (~45 KB gzipped) to honour an OS preference. Reduced motion is handled in CSS
 * instead, where every animation on this site already lives, and the only two
 * JS-driven animations were rewritten as CSS transitions.
 */
export function Providers({ children }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </ThemeProvider>
  );
}
