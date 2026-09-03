"use client";

import { useEffect, useState } from "react";
import headerNavLinks from "../../data/headerNavLinks";
import ThemeSwitch from "./themeswitch";
import MobileNav from "./mobilenav";
import RssModal from "./rss-modal";
import Link from "next/link";
import siteMetadata from "../../data/sitemetadata";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  // Scroll-elevate shadow (danarnoux-style): header gains depth after scroll.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`glass-header sticky top-0 z-40 border-b px-4 py-2 transition-shadow duration-300 ${
        scrolled ? "shadow-[0_14px_34px_-18px_var(--shadow-tint)]" : ""
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <Link href="/" aria-label={siteMetadata.publishName}>
          <span className="select-none rounded-lg px-3 py-1 text-xl font-semibold tracking-tight text-foreground transition-colors duration-200 hover:text-accent">
            {siteMetadata.publishName}
          </span>
        </Link>

        <nav className="flex items-center leading-6">
          <div className="hidden sm:block">
            {headerNavLinks.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.title}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`select-none rounded-lg px-3 py-2 text-sm transition-all duration-200 ${
                    active
                      ? "bg-accent-soft font-semibold text-accent"
                      : "text-muted hover:bg-surface-2 hover:text-accent"
                  }`}
                >
                  {link.title}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="flex items-center gap-1 leading-5">
          <RssModal />
          <MobileNav />
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}
