import Link from "next/link";
import EmailModal from "./email-modal";
import TenYearsLink from "./ten-years-link";
import sitemetadata, { siteRepo } from "../../data/sitemetadata";
import { getSiteYear } from "../lib/site-year";

/**
 * Server component, even though it renders client widgets (the email modal,
 * the icon buttons). Nothing here reads the route or the request, so the whole
 * footer is part of the static shell.
 *
 * `getSiteYear()` is async because the year is read inside a cached scope:
 * `new Date()` is banned in the prerendered shell under Cache Components, and
 * a cached read pins the value to a revalidation boundary instead. See
 * src/lib/site-year.js.
 */
export default async function Footer() {
  const year = await getSiteYear();

  return (
    <footer className="mt-16 border-t border-border">
      <div className="flex select-none flex-col items-center gap-4 py-8 text-sm text-muted sm:flex-row sm:gap-0">
        <p>
          © {year} {sitemetadata.publishName}
        </p>
        <p className="sm:ml-4 sm:border-l sm:border-border sm:pl-4">
          Powered by{" "}
          <Link href="https://nextjs.org/" target="_blank" className="link">
            Next.js
          </Link>{" "}
          and{" "}
          <Link href="https://vercel.com/" target="_blank" className="link">
            Vercel
          </Link>
        </p>

        <span className="sm:ml-4 sm:border-l sm:border-border sm:pl-4">
          <TenYearsLink />
        </span>

        <span className="inline-flex items-center gap-1 sm:ml-auto">
          <Link
            href={`https://www.github.com/${sitemetadata.github}/${siteRepo}`}
            aria-label="GitHub"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-icon"
          >
            <svg
              className="h-5 w-5"
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
          {sitemetadata.zhihu ? (
            <Link
              href={sitemetadata.zhihu}
              aria-label="知乎"
              title="知乎"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-icon"
            >
              <svg
                className="h-5 w-5"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M5.721 0C2.251 0 0 2.25 0 5.719V18.28C0 21.751 2.252 24 5.721 24h12.56C21.751 24 24 21.75 24 18.281V5.72C24 2.249 21.75 0 18.281 0zm1.964 4.078c-.271.73-.5 1.434-.68 2.11h4.587c.545-.006.445 1.168.445 1.171H9.384a58.104 58.104 0 01-.112 3.797h2.712c.388.023.393 1.251.393 1.266H9.183a9.223 9.223 0 01-.408 2.102l.757-.604c.452.456 1.512 1.712 1.906 2.177.473.681.063 2.081.063 2.081l-2.794-3.382c-.653 2.518-1.845 3.607-1.845 3.607-.523.468-1.58.82-2.64.516 2.218-1.73 3.44-3.917 3.667-6.497H4.491c0-.015.197-1.243.806-1.266h2.71c.024-.32.086-3.254.086-3.797H6.598c-.136.406-.158.447-.268.753-.594 1.095-1.603 1.122-1.907 1.155.906-1.821 1.416-3.6 1.591-4.064.425-1.124 1.671-1.125 1.671-1.125zM13.078 6h6.377v11.33h-2.573l-2.184 1.373-.401-1.373h-1.219zm1.313 1.219v8.86h.623l.263.937 1.455-.938h1.456v-8.86z" />
              </svg>
            </Link>
          ) : null}
          <EmailModal />
        </span>
      </div>
    </footer>
  );
}