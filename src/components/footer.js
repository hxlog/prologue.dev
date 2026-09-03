"use client";

import Link from "next/link";
import EmailModal from "./email-modal";
import sitemetadata, { siteRepo } from "../../data/sitemetadata";
import { currentYear } from "../lib/date";

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-border">
      <div className="container mx-auto flex select-none flex-col items-center px-8 py-8 sm:flex-row">
        <div className="text-sm text-muted">
          © {currentYear()} {sitemetadata.publishName}
        </div>
        <p className="mt-4 text-sm text-muted sm:ml-4 sm:mt-0 sm:border-l sm:border-border sm:pl-4">
          Powered by{" "}
          <Link
            href="https://nextjs.org/"
            target="_blank"
            className="transition-colors duration-200 hover:text-accent"
          >
            Next.js
          </Link>{" "}
          and{" "}
          <Link
            href="https://vercel.com/"
            target="_blank"
            className="transition-colors duration-200 hover:text-accent"
          >
            Vercel
          </Link>
        </p>

        <span className="mt-4 inline-flex items-center gap-1 sm:ml-auto sm:mt-0">
          <Link
            href={`https://www.github.com/${sitemetadata.github}/${siteRepo}`}
            aria-label="Github"
            target="_blank"
            className="rounded-full p-1 text-faint transition-all duration-200 hover:scale-105 hover:text-accent"
          >
            <svg
              className="h-6 w-6"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
          </Link>
          <EmailModal />
        </span>
      </div>
    </footer>
  );
}
