"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

const ThemeSwitch = () => {
  const [mounted, setMounted] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();

  // When mounted on client, now we can show the UI.
  // Defer the setState call so it is not called synchronously inside the effect
  // (prevents cascading renders and satisfies the ESLint rule).
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(t);
  }, []);

  // Circular reveal: wrap the theme swap in a View Transition anchored at the
  // click point (falls back to an instant swap where unsupported).
  const toggleTheme = (event) => {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    const root = document.documentElement;

    // Where the reveal starts: the click point, falling back to the button's
    // centre when the event carries no coordinates (keyboard activation, where
    // clientX/clientY are both 0).
    const rect = event.currentTarget?.getBoundingClientRect?.();
    const x = event.clientX || (rect ? rect.left + rect.width / 2 : window.innerWidth / 2);
    const y = event.clientY || (rect ? rect.top + rect.height / 2 : window.innerHeight / 2);

    const applyTheme = () => {
      root.classList.toggle("dark", next === "dark");
      root.classList.toggle("light", next === "light");
      setTheme(next);
    };

    if (typeof document.startViewTransition !== "function") {
      applyTheme();
      return;
    }

    root.style.setProperty("--vt-x", `${x}px`);
    root.style.setProperty("--vt-y", `${y}px`);
    root.classList.add("theme-vt");

    const release = () => root.classList.remove("theme-vt");

    // .finally() alone is not enough: if the transition is skipped or rejects,
    // .theme-vt would stick and `html.theme-vt * { transition: none }` would
    // freeze every transition on the site for the rest of the session.
    // .then(onFulfilled, onRejected) handles both outcomes the same way.
    document.startViewTransition(applyTheme).finished.then(release, release);
  };

  return (
    <button
      aria-label="Toggle Dark Mode"
      type="button"
      className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors duration-200 hover:bg-surface-2 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      onClick={toggleTheme}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-5 w-5 transition-transform duration-300 hover:scale-110"
      >
        {mounted && (resolvedTheme === "dark") ? (
          <path
            fillRule="evenodd"
            d="M8 10.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM8 12a4 4 0 100-8 4 4 0 000 8zM8 0a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0V.75A.75.75 0 018 0zm0 13a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 018 13zM2.343 2.343a.75.75 0 011.061 0l1.06 1.061a.75.75 0 01-1.06 1.06l-1.06-1.06a.75.75 0 010-1.06zm9.193 9.193a.75.75 0 011.06 0l1.061 1.06a.75.75 0 01-1.06 1.061l-1.061-1.06a.75.75 0 010-1.061zM16 8a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 0116 8zM3 8a.75.75 0 01-.75.75H.75a.75.75 0 010-1.5h1.5A.75.75 0 013 8zm10.657-5.657a.75.75 0 010 1.061l-1.061 1.06a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0zm-9.193 9.193a.75.75 0 010 1.06l-1.06 1.061a.75.75 0 11-1.061-1.06l1.06-1.061a.75.75 0 011.061 0z"
            clipRule="evenodd"
          />
        ) : (
          <path d="M9.598 1.591a.75.75 0 01.785-.175 7 7 0 11-8.967 8.967.75.75 0 01.961-.96 5.5 5.5 0 007.046-7.046.75.75 0 01.175-.786zm1.616 1.945a7 7 0 01-7.678 7.678 5.5 5.5 0 107.678-7.678z" />
        )}
      </svg>
    </button>
  );
};

export default ThemeSwitch;
