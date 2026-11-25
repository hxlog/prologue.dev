"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import headerNavLinks from "../../data/headerNavLinks";

/**
 * Desktop nav links. Client component only because the active-state highlight
 * needs `usePathname`; the static export resolves it during each per-route
 * build, so the prerendered HTML already carries aria-current/data-active and
 * there is no Suspense boundary (and no fallback duplicate list).
 */
export default function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {headerNavLinks.map((link) => {
        const active =
          pathname === link.href ||
          (link.href !== "/" && pathname.startsWith(link.href + "/"));

        return (
          <Link
            key={link.title}
            href={link.href}
            aria-current={active ? "page" : undefined}
            data-active={active ? "true" : undefined}
            className="nav-item select-none"
          >
            {link.title}
          </Link>
        );
      })}
    </>
  );
}