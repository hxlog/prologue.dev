const WORMHOLE_URL = "https://www.foreverblog.cn/go.html";

function WormholeIcon({ className = "h-4 w-4" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
      <path d="M12 6.5a5.5 5.5 0 1 0 5.5 5.5" />
      <path d="M12 10a2 2 0 1 0 2 2" strokeLinecap="round" />
      <path d="M16.5 3.5h4v4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 十年之约 · 虫洞.
 *
 * The wormhole URL is the official random-visit endpoint. Default wording is
 * the neutral "十年之约 · 虫洞"; the site owner is a member, but the link copy
 * stays as a link, not a claim.
 *
 * - footer: one inline `.link`, no extra row, no new colour.
 * - links:  the selected L1 banner card, reusing the existing card hover trio.
 */
export default function TenYearsLink({ variant = "footer" }) {
  if (variant === "links") {
    return (
      <section className="card card-interactive card-spotlight mt-10 flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:p-7">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Ten years</p>
          <h2 className="mt-1 flex items-center gap-2 text-title font-semibold tracking-tight text-foreground">
            <WormholeIcon className="h-5 w-5 text-accent" />
            十年之约 · 虫洞
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
            随机去一位十年之约成员博客看看。每一次点击，都是一次真实的到访。
          </p>
        </div>
        <a
          href={WORMHOLE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost shrink-0 self-start whitespace-nowrap sm:self-auto"
        >
          开始漫游
          <span aria-hidden="true">↗</span>
        </a>
      </section>
    );
  }

  return (
    <a
      href={WORMHOLE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="link inline-flex items-center gap-1 whitespace-nowrap"
      title="随机访问一位十年之约成员博客"
    >
      十年之约 · 虫洞
      <span aria-hidden="true">↗</span>
    </a>
  );
}
