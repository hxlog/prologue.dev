"use client";

import {
  Menu,
  Transition,
  MenuItems,
  MenuItem,
  MenuButton,
} from "@headlessui/react";
import { Fragment } from "react";
import Link from "next/link";
import headerNavLinks from "../../data/headerNavLinks";

/**
 * Mobile nav. No active-link state (that lives in the desktop NavLinks):
 * the menu closes as soon as a destination is chosen, so a highlight would
 * only be visible for the moment before the navigation commits.
 */
const MobileNav = () => {
  return (
    <Menu as="div" className="relative inline-block text-left sm:hidden">
      <MenuButton className="btn-icon" aria-label="Navigation">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 9h16.5m-16.5 6.75h16.5"
          />
        </svg>
      </MenuButton>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-(--duration-instant)"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <MenuItems className="modal-panel absolute right-0 z-50 mt-2 w-36 p-2">
          {headerNavLinks.map((link) => (
            <MenuItem key={link.title}>
              <Link href={link.href} prefetch={true} className="nav-item block">
                {link.title}
              </Link>
            </MenuItem>
          ))}
        </MenuItems>
      </Transition>
    </Menu>
  );
};

export default MobileNav;
