"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import headerNavLinks from "../../data/headerNavLinks";

/**
 * Desktop nav links.
 *
 * Split out of Navbar because `usePathname` is a client hook that reads URL
 * data: under Cache Components a shared layout that reads it suspends while
 * the static shell is generated for any route below it with dynamic params
 * (i.e. every post). The Navbar keeps the parts that do not read the route
 * (logo, icon toolbar, the scroll listener) prerendered, and wraps this list
 * in <Suspense> — see navbar.js.
 *
 * The fallback is the same list with no active state rather than nothing, so
 * the shell has the nav links in its HTML (they are links: useful before
 * hydration) and the row height is identical in both states.
 */
export function NavLinkList({ pathname }) {
  return (
    <>
      {headerNavLinks.map((link) => {
        const active = pathname
          ? pathname === link.href ||
            (link.href !== "/" && pathname.startsWith(`${link.href}/`))
          : false;

        return (
          <Link
            key={link.title}
            href={link.href}
            prefetch={link.href === "/about" ? true : "auto"}
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

/**
 * The route-aware half. Must be rendered inside a <Suspense> boundary whose
 * fallback is <NavLinkList /> without a pathname; see navbar.js.
 */
export default function NavLinks() {
  return <NavLinkList pathname={usePathname()} />;
}
