import fs from "fs";
import path from "path";
import { load } from "js-yaml";
import Link from "next/link";
import { formatDate } from "../lib/date";

export default function MicroblogSnippet() {
  const filePath = path.join(process.cwd(), "data", "microblog.yaml");
  const fileContent = fs.readFileSync(filePath, "utf8");
  const microblogs = load(fileContent)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 4);

  return (
    <div className="mx-auto mt-8 max-w-2xl">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
        <span
          className="inline-block h-3 w-1 rounded-full"
          style={{ background: "var(--gradient-brand)" }}
          aria-hidden="true"
        />
        微博
      </h2>
      {microblogs.map((microblog, index) => (
        <div key={`${microblog.date}-${index}`} className="my-4 last:mb-0">
          <time className="text-xs text-faint">{formatDate(microblog.date)}</time>
          <p className="mt-1.5 text-sm leading-6 text-muted">{microblog.content}</p>
        </div>
      ))}
      <Link href="/microblog" passHref>
        <p className="pt-2 text-right text-sm text-muted transition-colors duration-300 hover:text-accent hover:underline">
          阅读更多 →
        </p>
      </Link>
    </div>
  );
}
