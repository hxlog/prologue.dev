"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";

import { signOut } from "../../app/studio/actions/auth";
import {
  IconClose,
  IconCollections,
  IconDashboard,
  IconExternal,
  IconMedia,
  IconMenu,
  IconMoon,
  IconPages,
  IconPosts,
  IconSettings,
  IconSignOut,
  IconSun,
  IconTags,
} from "./icons";

/**
 * The studio's navigation.
 *
 * Ghost's admin is the reference for the *shape* — a persistent left rail,
 * content on the right, the site itself one click away in the rail's footer —
 * but not for the look: every colour here is a token from globals.css, because
 * /studio is the blog's admin and not a second application. A dark admin panel
 * bolted onto a light blog is the giveaway that the two were built separately.
 *
 * ## Three breakpoints, not two
 *
 *   < md  (phone)   A top bar with a hamburger opening a full-height drawer.
 *                   A 224px rail on a 390px screen is most of the viewport.
 *   md+   (tablet)  The rail is persistent. There is width for it, and a drawer
 *                   on a 10-inch tablet is worse than a rail.
 *   lg+   (desktop) The same rail; the content column caps itself.
 *
 * ## The drawer closes on click, not on route change
 *
 * The obvious implementation watches `pathname` in an effect and calls
 * `setState` when it changes. That is a cascading render, and React's guidance
 * is that an effect body should synchronise with an external system — a route
 * change is not one. Closing the drawer from the links themselves is both
 * simpler and correct, and it is the only place that knows a navigation was
 * *requested* rather than merely observed.
 */
export function StudioShell({ children, user, siteUrl }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Escape closes it. A drawer dismissable only by hitting a small target is a
  // trap on a phone.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-background">
      {/* ── phone top bar ────────────────────────────────────────────── */}
      <header className="glass-header sticky top-0 z-40 flex items-center justify-between border-b px-4 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="打开菜单"
          aria-expanded={drawerOpen}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-accent"
        >
          <IconMenu />
        </button>
        <Link
          href="/studio"
          onClick={closeDrawer}
          className="text-sm font-semibold tracking-tight text-foreground"
        >
          Studio
        </Link>
        <ThemeToggle />
      </header>

      {/* ── drawer ───────────────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* The scrim is a button, not a div: tapping outside is the natural
              gesture and it must be reachable by keyboard too. */}
          <button
            type="button"
            aria-label="关闭菜单"
            onClick={closeDrawer}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-surface shadow-pop">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-semibold text-foreground">Studio</span>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="关闭菜单"
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-accent"
              >
                <IconClose className="h-4 w-4" />
              </button>
            </div>
            <Rail pathname={pathname} onNavigate={closeDrawer} />
            <RailFooter user={user} siteUrl={siteUrl} onNavigate={closeDrawer} />
          </div>
        </div>
      )}

      <div className="flex">
        {/* ── persistent rail (tablet and up) ────────────────────────── */}
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">
          <div className="px-5 py-4">
            <Link href="/studio" className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="h-6 w-6 rounded-lg"
                style={{ background: "var(--gradient-brand)" }}
              />
              <span className="text-sm font-semibold tracking-tight text-foreground">
                Studio
              </span>
            </Link>
          </div>
          <Rail pathname={pathname} />
          <RailFooter user={user} siteUrl={siteUrl} />
        </aside>

        {/* ── content ─────────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

function Rail({ pathname, onNavigate }) {
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
      {NAV.map((item) => {
        // `exact` for the dashboard, prefix-matching for the rest: /studio is a
        // prefix of every other entry, so without it the dashboard is marked
        // current on every page.
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-accent-soft font-medium text-accent"
                : "text-muted hover:bg-surface-2 hover:text-accent"
            }`}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function RailFooter({ user, siteUrl, onNavigate }) {
  return (
    <div className="space-y-0.5 border-t border-border px-3 py-3">
      <a
        href={siteUrl}
        target="_blank"
        rel="noreferrer"
        onClick={onNavigate}
        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-accent"
      >
        <IconExternal className="h-[18px] w-[18px] shrink-0" />
        查看站点
      </a>

      <div className="flex items-center gap-2.5 rounded-lg px-3 py-2">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-medium text-muted"
        >
          {(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-faint" title={user?.email}>
          {user?.email}
        </span>
      </div>

      {/*
        A Server Action, not a form POST to a route. The action clears the cookie
        and redirects in one round trip, and — unlike a `GET /studio/logout`
        link — it cannot be triggered by an <img> tag or a prefetcher, which is
        the classic way a "log out" link becomes a way to log the author out.
      */}
      <form action={signOut}>
        <button
          type="submit"
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-accent"
        >
          <IconSignOut className="h-[18px] w-[18px] shrink-0" />
          退出登录
        </button>
      </form>
    </div>
  );
}

/**
 * Theme toggle.
 *
 * `mounted` gates the icon: the server does not know the reader's theme, so
 * rendering a sun or a moon during SSR guarantees a hydration mismatch whenever
 * the client disagrees. A same-sized placeholder until mount keeps the layout
 * from shifting when the real icon arrives.
 */
export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(t);
  }, []);

  if (!mounted) {
    return <span aria-hidden="true" className="block h-9 w-9" />;
  }

  const dark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "切换到浅色" : "切换到深色"}
      className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-accent"
    >
      {dark ? (
        <IconSun className="h-[18px] w-[18px]" />
      ) : (
        <IconMoon className="h-[18px] w-[18px]" />
      )}
    </button>
  );
}

const NAV = [
  { href: "/studio", label: "概览", icon: IconDashboard, exact: true },
  { href: "/studio/posts", label: "文章", icon: IconPosts },
  { href: "/studio/pages", label: "页面", icon: IconPages },
  { href: "/studio/collections", label: "集合", icon: IconCollections },
  { href: "/studio/media", label: "媒体", icon: IconMedia },
  { href: "/studio/tags", label: "标签", icon: IconTags },
  { href: "/studio/settings", label: "设置", icon: IconSettings },
];
