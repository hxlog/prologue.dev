"use client";

import Link from "next/link";
import headerNavLinks from "../../data/headerNavLinks";
import {
  Menu,
  Transition,
  MenuItems,
  MenuItem,
  MenuButton,
} from "@headlessui/react";
import { Fragment } from "react";

const MobileNav = () => {
  return (
    <Menu as="div" className="relative inline-block text-left sm:hidden">
      <div>
        <MenuButton
          className="inline-flex justify-center px-2 text-sm font-medium"
          aria-label="Navigation"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-6 h-6 text-muted transition-colors duration-200 hover:text-accent"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 9h16.5m-16.5 6.75h16.5"
            />
          </svg>
        </MenuButton>
      </div>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <MenuItems className="absolute right-0 z-50 mt-2 w-32 rounded-xl border border-border bg-surface p-2 shadow-pop">
          <div className="text-sm text-muted">
            {headerNavLinks.map((link) => {
              return (
                <div key={link.title} className="py-0.5">
                  <MenuItem>
                    <Link
                      href={link.href}
                      className="block rounded-lg px-3 py-2 transition-colors duration-150 hover:bg-surface-2 hover:text-accent"
                    >
                      {link.title}
                    </Link>
                  </MenuItem>
                </div>
              );
            })}
          </div>
        </MenuItems>
      </Transition>
    </Menu>
  );
};

export default MobileNav;
